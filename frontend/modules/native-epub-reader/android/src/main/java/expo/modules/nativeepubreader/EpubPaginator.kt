package expo.modules.nativeepubreader

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.text.Layout
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.StaticLayout
import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.ForegroundColorSpan
import android.text.style.LeadingMarginSpan
import android.text.style.MetricAffectingSpan
import android.text.style.RelativeSizeSpan
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import android.util.TypedValue
import kotlin.math.roundToInt
import java.util.concurrent.CancellationException

private const val DEFAULT_READER_LINE_HEIGHT_MULT = 1.5f

class EpubPaginator(
  private val pageWidth: Int,
  private val pageHeight: Int,
  private val paddingH: Int,
  private val paddingV: Int,
  private val fontSizeSp: Float,
  private val lineHeightMult: Float,
  private val isDark: Boolean,
  private val readerTextColor: Int,
  private val context: Context,
  // Extra vertical space added above each line to hold pinyin annotations (0 when
  // the pinyin toggle is off). Applied as leading so lines separate and the ruby
  // row has room; the page view draws the pinyin into that gap.
  private val rubySpacePx: Int = 0
) {
  private val contentWidth = (pageWidth - (paddingH * 2)).coerceAtLeast(1)
  private val contentHeight = (pageHeight - (paddingV * 2)).coerceAtLeast(1)
  private val density = context.resources.displayMetrics.density
  private val loadedFonts = mutableMapOf<String, Typeface>()

  fun paginate(rawBlocks: List<Any?>): List<ReaderPage> {
    val pages = mutableListOf<ReaderPage>()
    val currentPageBlocks = mutableListOf<PageBlock>()
    var usedHeight = 0
    val builtBlocks = normalizeParagraphBoundarySpacing(
      rawBlocks.mapNotNull { raw ->
        throwIfCancelled()
        val block = raw.asMap() ?: return@mapNotNull null
        buildPageBlock(block)
      }
    )
    builtBlocks.forEach { pageBlock ->
      throwIfCancelled()
      val blockTotal = pageBlock.marginTop + blockContentHeight(pageBlock) + pageBlock.marginBottom

      when {
        shouldSplitTextBlock(pageBlock, blockTotal, usedHeight) -> {
          usedHeight = splitTextBlock(pageBlock, usedHeight, currentPageBlocks, pages)
        }
        blockTotal > contentHeight -> {
          if (currentPageBlocks.isNotEmpty()) {
            pages.add(ReaderPage(pages.size, currentPageBlocks.toList()))
            currentPageBlocks.clear()
          }
          currentPageBlocks.add(pageBlock.copy(marginTop = 0, marginBottom = 0))
          pages.add(ReaderPage(pages.size, currentPageBlocks.toList()))
          currentPageBlocks.clear()
          usedHeight = 0
        }
        usedHeight + blockTotal > contentHeight -> {
          if (currentPageBlocks.isNotEmpty()) {
            pages.add(ReaderPage(pages.size, currentPageBlocks.toList()))
            currentPageBlocks.clear()
          }
          currentPageBlocks.add(pageBlock)
          usedHeight = blockTotal
        }
        else -> {
          currentPageBlocks.add(pageBlock)
          usedHeight += blockTotal
        }
      }
    }

    if (currentPageBlocks.isNotEmpty()) {
      pages.add(ReaderPage(pages.size, currentPageBlocks.toList()))
    }

    return pages.ifEmpty { listOf(ReaderPage(0, emptyList())) }
  }

  private fun shouldSplitTextBlock(
    block: PageBlock,
    blockTotal: Int,
    usedHeight: Int
  ): Boolean {
    if (block.type != "text") {
      return false
    }

    if (blockTotal > contentHeight) {
      return true
    }

    if (usedHeight <= 0 || usedHeight + blockTotal <= contentHeight) {
      return false
    }

    return canSplitBodyText(block)
  }

  private fun canSplitBodyText(block: PageBlock): Boolean {
    val tag = block.tag.lowercase()

    return !tag.startsWith("h") && tag != "figcaption"
  }

  fun buildContinuousPage(rawBlocks: List<Any?>): ReaderPage {
    val pageBlocks = normalizeParagraphBoundarySpacing(
      rawBlocks.mapNotNull { raw ->
        throwIfCancelled()
        val block = raw.asMap() ?: return@mapNotNull null
        buildPageBlock(block)
      }
    )

    return ReaderPage(0, pageBlocks)
  }

  private fun normalizeParagraphBoundarySpacing(blocks: List<PageBlock>): List<PageBlock> {
    return blocks.mapIndexed { index, block ->
      val nextBlock = blocks.getOrNull(index + 1)
      val currentHasIndent = hasParagraphIndent(block)
      val nextHasIndent = nextBlock?.let { hasParagraphIndent(it) } ?: false

      if (!needsParagraphBoundarySpacing(block, nextBlock, currentHasIndent, nextHasIndent)) {
        return@mapIndexed block
      }

      val boundaryGap = paragraphBoundaryGap(block)

      if (boundaryGap > block.marginBottom) {
        block.copy(marginBottom = boundaryGap)
      } else {
        block
      }
    }
  }

  private fun needsParagraphBoundarySpacing(
    block: PageBlock,
    nextBlock: PageBlock?,
    blockHasIndent: Boolean = hasParagraphIndent(block),
    nextBlockHasIndent: Boolean = nextBlock?.let { hasParagraphIndent(it) } ?: false
  ): Boolean {
    if (nextBlock == null) return false
    if (block.type != "text" || nextBlock.type != "text") return false
    if (block.tag != "p" || nextBlock.tag != "p") return false
    if (block.marginBottom > 0 || nextBlock.marginTop > 0) return false

    return blockHasIndent || nextBlockHasIndent || block.lineHeightMult > 1f || nextBlock.lineHeightMult > 1f
  }

  private fun hasParagraphIndent(block: PageBlock): Boolean {
    if (block.marginLeft > 0) return true

    val text = block.styledText ?: return false
    return text
      .getSpans(0, text.length, LeadingMarginSpan::class.java)
      .any { span ->
        span.getLeadingMargin(true) > 0 || span.getLeadingMargin(false) > 0
      }
  }

  private fun paragraphBoundaryGap(block: PageBlock): Int {
    val text = block.styledText ?: return 0
    val paint = block.textPaint ?: return 0
    if (text.isEmpty() || lineHeightMult <= 1f) return 0

    val layout = block.textLayout ?: buildTextLayout(block, text)
    if (layout.lineCount <= 0) return 0

    val lastLine = layout.lineCount - 1
    val targetBaselineGap = if (layout.lineCount > 1) {
      (layout.getLineBaseline(lastLine) - layout.getLineBaseline(lastLine - 1)).toFloat()
    } else {
      val metrics = paint.fontMetrics
      (metrics.descent - metrics.ascent) * lineHeightMult
    }
    val currentBoundaryGap =
      (layout.height - layout.getLineBaseline(lastLine)) + layout.getLineBaseline(0)
    val missingGap = targetBaselineGap - currentBoundaryGap
    val metrics = paint.fontMetrics
    val naturalLineHeight = metrics.descent - metrics.ascent
    val lineHeightLeading = (naturalLineHeight * (block.lineHeightMult - 1f)).roundToInt().coerceAtLeast(0)

    return maxOf(missingGap.roundToInt(), lineHeightLeading).coerceAtLeast(0)
  }

  private fun buildPageBlock(block: Map<*, *>): PageBlock? {
    val rawType = block.stringValue("type")
    val tag = block.stringValue("tag") ?: "p"
    val styleTokens = block.mapValue("styleTokens")
    val blockId = block.stringValue("id") ?: "block-${block.hashCode()}"

    if (rawType == "image") {
      val imageUri = block.stringValue("fileUri") ?: block.mapValue("resource").stringValue("fileUri")
      val marginLeft = blockLeftInset(styleTokens)
      val imageContentWidth = (contentWidth - marginLeft).coerceAtLeast(1)
      val imageHeight = imageHeightForBlock(styleTokens, imageContentWidth)

      return PageBlock(
        blockId = blockId,
        type = "image",
        tag = tag,
        imageUri = imageUri,
        imageHeight = imageHeight,
        contentWidth = imageContentWidth,
        marginLeft = marginLeft,
        marginTop = spacingFromToken(styleTokens["marginTop"], 8f),
        marginBottom = spacingFromToken(styleTokens["marginBottom"], 12f)
      )
    }

    val spans = block.listValue("spans")
    val fallbackText = block.stringValue("text") ?: ""
    val styledText = buildStyledText(fallbackText, spans)
    val textIndentPx = spacingFromTokenSigned(styleTokens["textIndent"], 0f).toFloat()
    val blockIndentPx = blockLeftInset(styleTokens).toFloat()
    val firstLineAbsolute = (blockIndentPx + textIndentPx).coerceAtLeast(0f)
    val restLinesAbsolute = blockIndentPx.coerceAtLeast(0f)
    val baseIndent = minOf(firstLineAbsolute, restLinesAbsolute).toInt()
    val firstLine = (firstLineAbsolute - baseIndent).coerceAtLeast(0f)
    val restLines = (restLinesAbsolute - baseIndent).coerceAtLeast(0f)

    if (styledText.isEmpty() && fallbackText.isBlank()) {
      return null
    }

    if ((firstLine > 0f || restLines > 0f) && styledText.isNotEmpty()) {
      styledText.setSpan(
        LeadingMarginSpan.Standard(firstLine.toInt(), restLines.toInt()),
        0,
        styledText.length,
        Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
      )
    }

    val textPaint = textPaintForBlock(tag, styleTokens)
    val blockLineHeightMult = lineHeightMultiplierForBlock(styleTokens["lineHeight"], textPaint.textSize)
    val marginTop = spacingFromToken(styleTokens["marginTop"], 0f)
    val marginBottom = spacingFromToken(styleTokens["marginBottom"], defaultBottomMargin(tag))

    return withTextLayout(PageBlock(
      blockId = blockId,
      type = "text",
      tag = tag,
      styledText = styledText,
      plainText = styledText.toString(),
      sourceStartOffset = 0,
      textPaint = textPaint,
      textAlign = alignmentForTextAlign(styleTokens["textAlign"]),
      contentWidth = (contentWidth - baseIndent).coerceAtLeast(1),
      marginLeft = baseIndent,
      marginTop = marginTop,
      marginBottom = marginBottom,
      lineHeightMult = blockLineHeightMult,
      sentenceRanges = splitSentences(styledText.toString())
    ))
  }

  private fun blockContentHeight(block: PageBlock): Int {
    if (block.type == "image") {
      return block.imageHeight
    }

    val text = block.styledText ?: return 0
    if (text.isEmpty()) {
      return 0
    }

    return (block.textLayout ?: buildTextLayout(block, text)).height
  }

  private fun splitTextBlock(
    block: PageBlock,
    initialUsedHeight: Int,
    currentPageBlocks: MutableList<PageBlock>,
    pages: MutableList<ReaderPage>
  ): Int {
    var remainingText = block.styledText ?: return initialUsedHeight
    var remainingSourceStartOffset = block.sourceStartOffset
    var usedHeight = initialUsedHeight
    var isFirstSlice = true

    while (remainingText.isNotEmpty()) {
      throwIfCancelled()
      val marginTop = if (isFirstSlice) block.marginTop else 0
      val availableHeight = contentHeight - usedHeight - marginTop

      if (availableHeight <= 0) {
        if (currentPageBlocks.isNotEmpty()) {
          pages.add(ReaderPage(pages.size, currentPageBlocks.toList()))
          currentPageBlocks.clear()
        }
        usedHeight = 0
        isFirstSlice = false
        continue
      }

      val candidateBlock = withTextLayout(block.copy(
        styledText = remainingText,
        plainText = remainingText.toString(),
        sourceStartOffset = remainingSourceStartOffset,
        textLayout = null,
        marginTop = marginTop,
        marginBottom = block.marginBottom
      ))
      val candidateHeight = blockContentHeight(candidateBlock)

      if (usedHeight + marginTop + candidateHeight + block.marginBottom <= contentHeight) {
        currentPageBlocks.add(candidateBlock)
        return usedHeight + marginTop + candidateHeight + block.marginBottom
      }

      val layout = candidateBlock.textLayout ?: buildTextLayout(candidateBlock, remainingText)
      val splitLine = lastLineThatFits(layout, availableHeight)

      if (splitLine < 0) {
        if (currentPageBlocks.isNotEmpty()) {
          pages.add(ReaderPage(pages.size, currentPageBlocks.toList()))
          currentPageBlocks.clear()
          usedHeight = 0
          isFirstSlice = false
          continue
        }
      }

      val safeLine = splitLine.coerceAtLeast(0)
      val splitOffset = layout.getLineEnd(safeLine).coerceIn(1, remainingText.length)
      val firstSliceText = copySpannableRange(remainingText, 0, splitOffset)
      val firstSliceBlock = withTextLayout(block.copy(
        styledText = firstSliceText,
        plainText = firstSliceText.toString(),
        sourceStartOffset = remainingSourceStartOffset,
        textLayout = null,
        marginTop = marginTop,
        marginBottom = 0
      ))

      currentPageBlocks.add(firstSliceBlock)
      pages.add(ReaderPage(pages.size, currentPageBlocks.toList()))
      currentPageBlocks.clear()

      remainingText = copySpannableRange(remainingText, splitOffset, remainingText.length)
      remainingSourceStartOffset += splitOffset
      resetLeadingMarginSpansForContinuation(remainingText)
      usedHeight = 0
      isFirstSlice = false
    }

    return usedHeight
  }

  private fun lastLineThatFits(layout: StaticLayout, availableHeight: Int): Int {
    var result = -1

    for (line in 0 until layout.lineCount) {
      if (layout.getLineBottom(line) <= availableHeight) {
        result = line
      } else {
        break
      }
    }

    return result
  }

  private fun buildTextLayout(block: PageBlock, text: SpannableStringBuilder): StaticLayout {
    throwIfCancelled()
    return StaticLayout.Builder
      .obtain(text, 0, text.length, block.textPaint!!, block.contentWidth.coerceAtLeast(1))
      .setAlignment(block.textAlign)
      // spacingAdd sits below each line = above the next, which is exactly where the
      // pinyin row goes; 0 when pinyin is off so normal reading stays dense.
      .setLineSpacing(rubySpacePx.toFloat(), block.lineHeightMult)
      .setIncludePad(true)
      .build()
  }

  private fun withTextLayout(block: PageBlock): PageBlock {
    val text = block.styledText

    if (block.type != "text" || text == null || text.isEmpty() || block.textLayout != null) {
      return block
    }

    return block.copy(textLayout = buildTextLayout(block, text))
  }

  private fun throwIfCancelled() {
    if (Thread.currentThread().isInterrupted) {
      throw CancellationException("Pagination was cancelled")
    }
  }

  private fun buildStyledText(fallbackText: String, spans: List<*>): SpannableStringBuilder {
    if (spans.isEmpty()) {
      return SpannableStringBuilder(fallbackText)
    }

    val builder = SpannableStringBuilder()

    spans.forEach { rawSpan ->
      val span = rawSpan.asMap() ?: return@forEach
      val spanText = span.stringValue("text") ?: return@forEach
      val start = builder.length
      builder.append(spanText)
      val end = builder.length

      if (start == end) {
        return@forEach
      }

      val marks = span.listValue("marks").mapNotNull { it as? String }
      val styleTokens = span.mapValue("styleTokens")

      characterStylesForSpan(marks, styleTokens).forEach { style ->
        builder.setSpan(style, start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
      }
    }

    if (builder.isEmpty() && fallbackText.isNotEmpty()) {
      builder.append(fallbackText)
    }

    return builder
  }

  private fun copySpannableRange(
    source: SpannableStringBuilder,
    start: Int,
    end: Int
  ): SpannableStringBuilder {
    val safeStart = start.coerceIn(0, source.length)
    val safeEnd = end.coerceIn(safeStart, source.length)
    val copy = SpannableStringBuilder(source.subSequence(safeStart, safeEnd))

    source.getSpans(safeStart, safeEnd, Any::class.java).forEach { span ->
      val spanStart = source.getSpanStart(span).coerceAtLeast(safeStart)
      val spanEnd = source.getSpanEnd(span).coerceAtMost(safeEnd)

      if (spanStart >= spanEnd) {
        return@forEach
      }

      val copiedSpan = if (span is CharacterStyle) CharacterStyle.wrap(span) else span
      copy.setSpan(
        copiedSpan,
        spanStart - safeStart,
        spanEnd - safeStart,
        source.getSpanFlags(span)
      )
    }

    return copy
  }

  private fun textPaintForBlock(tag: String, styleTokens: Map<*, *>): TextPaint {
    return TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply {
      color = textColorForToken(styleTokens["color"])
      textSize = sp(textSizeForBlock(tag, styleTokens))
      typeface = typefaceForStyle(styleTokens, tag)
    }
  }

  private fun characterStylesForSpan(
    marks: List<String>,
    styleTokens: Map<*, *>
  ): List<CharacterStyle> {
    val styles = mutableListOf<CharacterStyle>()
    val weight = styleTokens["fontWeight"]
    val fontStyle = styleTokens["fontStyle"] as? String
    val decoration = styleTokens["textDecorationLine"] as? String
    val color = if (isDark) null else colorFromToken(styleTokens["color"])
    val fontScale = numericValue(styleTokens["fontScale"])?.toFloat()
    val fontFamily = styleTokens["fontFamily"] as? String

    if (!fontFamily.isNullOrBlank()) {
      styles.add(FontFamilySpan(resolveFontFamily(fontFamily)))
    }

    if (marks.any { it == "strong" || it == "b" } || isBoldWeight(weight)) {
      styles.add(StyleSpan(Typeface.BOLD))
    }

    if (marks.any { it == "em" || it == "i" } || fontStyle == "italic") {
      styles.add(StyleSpan(Typeface.ITALIC))
    }

    if (marks.contains("a") || decoration == "underline") {
      styles.add(UnderlineSpan())
    }

    if (color != null) {
      styles.add(ForegroundColorSpan(color))
    }

    if (fontScale != null && fontScale > 0f && fontScale != 1f) {
      styles.add(RelativeSizeSpan(fontScale))
    }

    return styles
  }

  private fun textSizeForBlock(tag: String, styleTokens: Map<*, *>): Float {
    val scale = numericValue(styleTokens["fontScale"])?.toFloat() ?: 1f
    val defaultBase = when {
      tag == "h1" -> 26f
      tag == "h2" -> 23f
      tag == "h3" -> 20f
      tag.startsWith("h") -> 18f
      tag == "figcaption" -> 14f
      else -> 18f
    }
    val globalScale = fontSizeSp / 18f
    val fontSizeToken = styleTokens["fontSize"]
    val resolvedBase = if (usesReaderBodyFontBase(tag)) {
      val relativeScale = relativeFontScaleFromToken(fontSizeToken) ?: 1f
      defaultBase * scale * relativeScale
    } else {
      fontSizeFromToken(fontSizeToken, defaultBase) ?: (defaultBase * scale)
    }
    val resolved = resolvedBase * globalScale
    val minSize = when {
      tag.startsWith("h") -> 12f
      tag == "figcaption" -> 9f
      else -> 8f
    }
    val maxSize = if (tag.startsWith("h")) 44f else 36f

    return resolved.coerceIn(minSize, maxSize)
  }

  private fun lineHeightMultiplierForBlock(value: Any?, textSizePx: Float): Float {
    val readerScale = lineHeightMult / DEFAULT_READER_LINE_HEIGHT_MULT
    val cssLineHeight = lineHeightMultiplierFromToken(value, textSizePx)
    val baseLineHeight = cssLineHeight ?: DEFAULT_READER_LINE_HEIGHT_MULT

    return (baseLineHeight * readerScale).coerceIn(1f, 3f)
  }

  private fun lineHeightMultiplierFromToken(value: Any?, textSizePx: Float): Float? {
    val safeTextSize = textSizePx.takeIf { it > 0f } ?: return null

    return when (value) {
      is Number -> {
        val number = value.toFloat()

        when {
          number <= 0f -> null
          number <= 4f -> number
          else -> (number * density) / safeTextSize
        }
      }
      is Map<*, *> -> {
        val unit = (value["unit"] as? String)?.trim()?.lowercase()
        val number = cssNumber(value["value"])?.toFloat() ?: return null

        lineHeightMultiplierFromNumber(number, unit, safeTextSize)
      }
      is String -> {
        val trimmed = value.trim().lowercase()
        if (trimmed == "normal") {
          return null
        }

        val number = cssNumber(trimmed)?.toFloat() ?: return null
        val unit = when {
          trimmed.endsWith("%") -> "%"
          trimmed.endsWith("em") -> "em"
          trimmed.endsWith("rem") -> "rem"
          trimmed.endsWith("px") -> "px"
          trimmed.endsWith("dp") -> "dp"
          else -> null
        }

        lineHeightMultiplierFromNumber(number, unit, safeTextSize)
      }
      else -> null
    }
  }

  private fun lineHeightMultiplierFromNumber(number: Float, unit: String?, textSizePx: Float): Float? {
    if (number <= 0f) {
      return null
    }

    return when (unit) {
      "%" -> number / 100f
      "em", "rem" -> number
      "px", "dp" -> (number * density) / textSizePx
      else -> if (number <= 4f) number else (number * density) / textSizePx
    }
  }

  private fun usesReaderBodyFontBase(tag: String): Boolean {
    return !tag.startsWith("h") && tag != "figcaption"
  }

  private fun typefaceForStyle(styleTokens: Map<*, *>, tag: String): Typeface {
    val bold = tag.startsWith("h") || isBoldWeight(styleTokens["fontWeight"])
    val italic = (styleTokens["fontStyle"] as? String)?.lowercase() == "italic"
    val style = when {
      bold && italic -> Typeface.BOLD_ITALIC
      bold -> Typeface.BOLD
      italic -> Typeface.ITALIC
      else -> Typeface.NORMAL
    }
    val base = resolveFontFamily(styleTokens["fontFamily"] as? String)

    return Typeface.create(base, style)
  }

  private fun resolveFontFamily(family: String?): Typeface {
    if (family != null) {
      family
        .lowercase()
        .split(",")
        .map { it.trim().trim('"', '\'') }
        .forEach { name ->
          when {
            name == "serif" || name.contains("georgia") ||
              name.contains("garamond") || name.contains("times") ||
              name.contains("palatino") || name.contains("book antiqua") ->
              return Typeface.SERIF

            name == "sans-serif" || name.contains("helvetica") ||
              name.contains("arial") || name.contains("verdana") ||
              name.contains("roboto") || name.contains("noto sans") ->
              return Typeface.SANS_SERIF

            name == "monospace" || name.contains("courier") ||
              name.contains("monaco") || name.contains("consolas") ->
              return Typeface.MONOSPACE

            loadedFonts.containsKey(name) ->
              return loadedFonts[name]!!
          }
        }
    }

    return Typeface.SERIF
  }

  private fun alignmentForTextAlign(value: Any?): Layout.Alignment {
    return when ((value as? String)?.lowercase()) {
      "center" -> Layout.Alignment.ALIGN_CENTER
      "right", "end" -> Layout.Alignment.ALIGN_OPPOSITE
      else -> Layout.Alignment.ALIGN_NORMAL
    }
  }

  private fun defaultBottomMargin(tag: String): Float {
    return when {
      tag.startsWith("h") -> 12f
      tag == "li" -> 6f
      else -> 10f
    }
  }

  private fun blockLeftInset(styleTokens: Map<*, *>): Int {
    val marginLeft = spacingFromToken(styleTokens["marginLeft"], 0f)
    val paddingLeft = spacingFromToken(styleTokens["paddingLeft"], 0f)

    return (marginLeft + paddingLeft).coerceAtLeast(0)
  }

  private fun imageHeightForBlock(styleTokens: Map<*, *>, imageContentWidth: Int): Int {
    if (styleTokens.containsKey("height")) {
      return spacingFromToken(styleTokens["height"], 260f, 900f).coerceAtLeast(dp(120f))
    }

    val intrinsicWidth = numericValue(styleTokens["intrinsicWidth"])?.toFloat()
    val intrinsicHeight = numericValue(styleTokens["intrinsicHeight"])?.toFloat()
    if (
      intrinsicWidth != null &&
      intrinsicHeight != null &&
      intrinsicWidth > 0f &&
      intrinsicHeight > 0f
    ) {
      return ((imageContentWidth * intrinsicHeight) / intrinsicWidth)
        .roundToInt()
        .coerceIn(dp(120f), dp(900f))
    }

    return dp(260f)
  }

  private fun resetLeadingMarginSpansForContinuation(text: SpannableStringBuilder) {
    val spans = text.getSpans(0, text.length, LeadingMarginSpan::class.java)
    val continuationMargin = spans.maxOfOrNull { it.getLeadingMargin(false) } ?: 0

    spans.forEach { span ->
      text.removeSpan(span)
    }

    if (continuationMargin > 0 && text.isNotEmpty()) {
      text.setSpan(
        LeadingMarginSpan.Standard(continuationMargin, continuationMargin),
        0,
        text.length,
        Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
      )
    }
  }

  private fun isBoldWeight(value: Any?): Boolean {
    return when (value) {
      is Number -> value.toInt() >= 600
      is String -> value == "bold" || value.toIntOrNull()?.let { it >= 600 } == true
      else -> false
    }
  }

  private fun colorFromToken(value: Any?): Int? {
    val raw = value as? String ?: return null
    return try {
      Color.parseColor(raw)
    } catch (_: IllegalArgumentException) {
      null
    }
  }

  private fun textColorForToken(value: Any?): Int {
    return if (isDark) readerTextColor else colorFromToken(value) ?: readerTextColor
  }

  private fun spacingFromToken(
    value: Any?,
    fallbackDp: Float,
    maxDp: Float = 72f,
    emBaseSp: Float = fontSizeSp
  ): Int {
    val resolvedDp = spacingDpFromToken(value, fallbackDp, emBaseSp)
    val clampedDp = resolvedDp.coerceIn(-24f, maxDp)

    return (clampedDp * density).roundToInt()
  }

  private fun spacingFromTokenSigned(
    value: Any?,
    fallbackDp: Float,
    maxDp: Float = 72f,
    emBaseSp: Float = fontSizeSp
  ): Int {
    val resolvedDp = spacingDpFromToken(value, fallbackDp, emBaseSp)
    val clampedDp = resolvedDp.coerceIn(-maxDp, maxDp)

    return (clampedDp * density).roundToInt()
  }

  private fun spacingDpFromToken(value: Any?, fallbackDp: Float, emBaseSp: Float): Float {
    return when (value) {
      is Number -> value.toFloat()
      is Map<*, *> -> {
        val unit = (value["unit"] as? String)?.trim()?.lowercase()
        val number = cssNumber(value["value"])?.toFloat()

        when {
          number == null -> fallbackDp
          unit == "%" -> fallbackDp
          unit == "em" || unit == "rem" -> number * emBaseSp
          else -> number
        }
      }
      is String -> {
        val trimmed = value.trim().lowercase()

        if (trimmed == "auto" || trimmed.endsWith("%")) {
          fallbackDp
        } else {
          val number = cssNumber(trimmed)?.toFloat()

          when {
            number == null -> fallbackDp
            trimmed.endsWith("em") || trimmed.endsWith("rem") -> number * emBaseSp
            else -> number
          }
        }
      }
      else -> fallbackDp
    }
  }

  private fun fontSizeFromToken(value: Any?, baseSp: Float): Float? {
    return when (value) {
      is Number -> value.toFloat()
      is Map<*, *> -> {
        val unit = (value["unit"] as? String)?.trim()?.lowercase()
        val number = cssNumber(value["value"])?.toFloat() ?: return null

        when (unit) {
          "%" -> baseSp * (number / 100f)
          "em", "rem" -> baseSp * number
          else -> number
        }
      }
      is String -> {
        val trimmed = value.trim().lowercase()
        val number = cssNumber(trimmed)?.toFloat() ?: return null

        when {
          trimmed.endsWith("%") -> baseSp * (number / 100f)
          trimmed.endsWith("em") || trimmed.endsWith("rem") -> baseSp * number
          else -> number
        }
      }
      else -> null
    }
  }

  private fun relativeFontScaleFromToken(value: Any?): Float? {
    return when (value) {
      is Map<*, *> -> {
        val unit = (value["unit"] as? String)?.trim()?.lowercase()
        val number = cssNumber(value["value"])?.toFloat() ?: return null

        when (unit) {
          "%" -> number / 100f
          "em", "rem" -> number
          else -> null
        }
      }
      is String -> {
        val trimmed = value.trim().lowercase()
        val number = cssNumber(trimmed)?.toFloat() ?: return null

        when {
          trimmed.endsWith("%") -> number / 100f
          trimmed.endsWith("em") || trimmed.endsWith("rem") -> number
          else -> null
        }
      }
      else -> null
    }
  }

  private fun numericValue(value: Any?): Double? {
    return cssNumber(value)
  }

  private fun cssNumber(value: Any?): Double? {
    return when (value) {
      is Number -> value.toDouble()
      is String -> value
        .trim()
        .lowercase()
        .replace("%", "")
        .replace("px", "")
        .replace("dp", "")
        .replace("rem", "")
        .replace("em", "")
        .toDoubleOrNull()
      else -> null
    }
  }

  private fun sp(value: Float): Float {
    return TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_SP,
      value,
      context.resources.displayMetrics
    )
  }

  private fun dp(value: Float): Int {
    return (value * density).roundToInt()
  }

  private fun Any?.asMap(): Map<*, *>? = this as? Map<*, *>

  private fun Map<*, *>.stringValue(key: String): String? = this[key] as? String

  private fun Map<*, *>.mapValue(key: String): Map<*, *> = this[key].asMap() ?: emptyMap<Any, Any>()

  private fun Map<*, *>.listValue(key: String): List<*> = this[key] as? List<*> ?: emptyList<Any>()
}

private class FontFamilySpan(
  private val typeface: Typeface
) : MetricAffectingSpan() {
  override fun updateDrawState(textPaint: TextPaint) {
    apply(textPaint)
  }

  override fun updateMeasureState(textPaint: TextPaint) {
    apply(textPaint)
  }

  private fun apply(textPaint: TextPaint) {
    val currentStyle = textPaint.typeface?.style ?: Typeface.NORMAL
    textPaint.typeface = Typeface.create(typeface, currentStyle)
  }
}
