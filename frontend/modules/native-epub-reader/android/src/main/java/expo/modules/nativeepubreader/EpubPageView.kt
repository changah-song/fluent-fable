package expo.modules.nativeepubreader

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.text.StaticLayout
import android.text.TextUtils
import android.text.TextPaint
import android.util.Log
import android.util.TypedValue
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.animation.PathInterpolator
import java.text.BreakIterator
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val PAGE_VIEW_TAG = "EpubPageView"

// Focus (sentence beam) mode rendering constants, mirroring the design spec:
// unfocused sentences sit at 22% opacity and focus shifts animate over 300ms.
private const val FOCUS_DIM_ALPHA = 0.22f
private const val FOCUS_TRANSITION_DURATION_MS = 300L
// Shortened transition used while the reader is stepping rapidly through
// sentences, so consecutive beam moves don't queue up behind slow animations.
private const val FOCUS_TRANSITION_FAST_DURATION_MS = 140L
// Slight second draw offset (dp) that emulates the focused sentence's heavier
// font weight without re-laying out the text.
private const val FOCUS_EMPHASIS_OFFSET_DP = 0.3f

private data class RenderedTextBlock(
  val block: PageBlock,
  val layout: StaticLayout,
  val x: Float,
  val y: Float,
  val width: Int
)

private data class LocalTokenRange(
  val start: Int,
  val end: Int
)

private data class TextPosition(
  val renderedIndex: Int,
  val block: PageBlock,
  val localOffset: Int,
  val sourceOffset: Int
)

private data class SelectionAnchor(
  val pageIndex: Int,
  val spineIndex: Int?,
  val blockId: String,
  val renderedIndex: Int,
  val localStartOffset: Int,
  val localEndOffset: Int,
  val sourceStartOffset: Int,
  val sourceEndOffset: Int
)

private enum class SelectionHandle {
  START,
  END
}

private data class SelectionHandleGeometry(
  val handle: SelectionHandle,
  val x: Float,
  val lineTop: Float,
  val lineBottom: Float,
  val knobCenterY: Float
)

private data class SelectionHandleLineMetrics(
  val x: Float,
  val stemTop: Float,
  val stemBottom: Float,
  val knobCenterY: Float
)

private data class SelectionHighlightVerticalMetrics(
  val top: Float,
  val bottom: Float
)

class EpubPageView(context: Context) : View(context) {
  private var page: ReaderPage? = null
  private var paddingH = 0
  private var paddingV = 0
  private var lineHeightMult = 1.5f
  private var pageBackgroundColor = Color.WHITE
  private var themePalette = readerThemePaletteForMode(false)
  private var activeSelectionRanges: List<TextRange> = emptyList()
  private var activeSelectionKind: ActiveSelectionKind? = null
  private var savedHighlightRanges: List<TextRange> = emptyList()
  private var levelRanges: List<TextRange> = emptyList()
  // When true, draw each level range's pinyin above the word (Chinese only). The
  // paginator reserves the vertical room; this view fills it.
  private var showPinyin: Boolean = false
  private var activeHighlightColor = themePalette.activeHighlightColor
  private var textSelectionHighlightColor = themePalette.textSelectionHighlightColor
  private var savedHighlightColor = themePalette.savedHighlightColor
  private var savedHighlightTextColor = themePalette.savedHighlightTextColor
  private var levelUnderlineEasyColor = themePalette.levelUnderlineEasyColor
  private var levelUnderlineMidColor = themePalette.levelUnderlineMidColor
  private var levelUnderlineHardColor = themePalette.levelUnderlineHardColor
  // §8: hard+frequent ("reinforced") words are blended toward this calm slate so they
  // read as "the book will reteach this" rather than "make a flashcard now"; the
  // salient easy→hard gradient stays for hard+rare ("study") words. v1 is a fixed tone
  // (not yet a theme token, so it does not swap for dark mode).
  private val reinforcedUnderlineTint = Color.rgb(0x5b, 0x6b, 0x8c)
  private var onWordSelected: ((WordHit) -> Unit)? = null
  private var onTextSelected: ((TextSelectionHit) -> Unit)? = null
  private var onSelectionCleared: (() -> Unit)? = null
  private var onSelectionDragStateChanged: ((Boolean) -> Unit)? = null
  private var onEdgeAction: ((ReaderEdgeKind) -> Unit)? = null
  private var onFocusTextTapped: ((String, Int) -> Unit)? = null
  private var focusModeEnabled = false
  // Set while the JS lookup panel is visible in focus mode; taps then dismiss
  // the panel instead of moving the beam or selecting another word.
  var focusPanelOpen = false
  private var focusRanges: List<FocusRange> = emptyList()
  private var previousFocusRanges: List<FocusRange> = emptyList()
  private var focusTransition = 1f
  private var focusAnimator: ValueAnimator? = null
  private val focusClipPath = Path()
  private val focusRangePath = Path()
  private var renderedTextBlocks = emptyList<RenderedTextBlock>()
  private var geometryDirty = true
  private val bitmapCache = mutableMapOf<String, Bitmap?>()
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private val longPressTimeout = ViewConfiguration.getLongPressTimeout().toLong()
  private val longPressHandler = Handler(Looper.getMainLooper())
  private var longPressRunnable: Runnable? = null
  private var tapStartX = 0f
  private var tapStartY = 0f
  private var isTapCandidate = false
  private var isSelectionMode = false
  private var activeSelectionHandle: SelectionHandle? = null
  private var handleDragStartRanges: List<TextRange> = emptyList()
  private var selectionAnchor: SelectionAnchor? = null
  private val highlightPath = Path()
  private val highlightBounds = RectF()
  private val savedHighlightPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = savedHighlightColor
    style = Paint.Style.FILL
  }
  private val savedHighlightTextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = savedHighlightTextColor
    style = Paint.Style.FILL
  }
  // One paint for every level underline. Its color and stroke width are set per
  // range from that word's gradient weight just before it is drawn.
  private val levelMarkPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = levelUnderlineEasyColor
    style = Paint.Style.STROKE
    strokeWidth = dp(1.7f).toFloat()
    strokeCap = Paint.Cap.ROUND
  }
  // Pinyin drawn above underlined words. Size/color are set from the body text at
  // draw time so it tracks the reader font and theme.
  private val pinyinPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    textAlign = Paint.Align.CENTER
  }
  private val activeHighlightPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = activeHighlightColor
    style = Paint.Style.FILL
  }
  private val selectionHandlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = themePalette.selectionHandleColor
    style = Paint.Style.STROKE
    strokeWidth = dp(2f).toFloat()
    strokeCap = Paint.Cap.ROUND
  }
  private val selectionHandleKnobPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = themePalette.selectionHandleColor
    style = Paint.Style.FILL
  }
  private val selectionLineRect = RectF()
  private val edgeButtonRect = RectF()
  private val edgeIconPath = Path()
  private val bookFinishedIconRect = RectF()
  private val bookFinishedIconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    isFilterBitmap = true
    isDither = true
  }
  private val bookFinishedIconBitmap by lazy {
    BitmapFactory.decodeResource(resources, R.drawable.book_over_icon)
  }
  private val edgeSansRegularTypeface by lazy { loadReaderSansTypeface(context, "regular") }
  private val edgeSansMediumTypeface by lazy { loadReaderSansTypeface(context, "medium") }
  private val edgeSansBoldTypeface by lazy { loadReaderSansTypeface(context, "bold") }
  private val edgeDisplayTypeface by lazy { loadReaderDisplayTypeface(context, "medium") }
  private val placeholderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = themePalette.placeholderColor
    style = Paint.Style.FILL
  }

  fun bind(
    page: ReaderPage,
    paddingH: Int,
    paddingV: Int,
    lineHeightMult: Float,
    backgroundColor: Int,
    themePalette: ReaderThemePalette,
    activeSelectionRanges: List<TextRange>,
    activeSelectionKind: ActiveSelectionKind?,
    savedHighlightRanges: List<TextRange>,
    levelRanges: List<TextRange>,
    activeHighlightColor: Int,
    textSelectionHighlightColor: Int,
    savedHighlightColor: Int,
    savedHighlightTextColor: Int,
    levelUnderlineEasyColor: Int,
    levelUnderlineMidColor: Int,
    levelUnderlineHardColor: Int,
    onWordSelected: ((WordHit) -> Unit)?,
    onTextSelected: ((TextSelectionHit) -> Unit)?,
    onSelectionCleared: (() -> Unit)?,
    onSelectionDragStateChanged: ((Boolean) -> Unit)?,
    onEdgeAction: ((ReaderEdgeKind) -> Unit)?,
    focusModeEnabled: Boolean = false,
    onFocusTextTapped: ((String, Int) -> Unit)? = null,
    showPinyin: Boolean = false
  ) {
    this.showPinyin = showPinyin
    this.page = page
    this.paddingH = paddingH
    this.paddingV = paddingV
    this.lineHeightMult = lineHeightMult
    this.pageBackgroundColor = backgroundColor
    this.themePalette = themePalette
    selectionHandlePaint.color = themePalette.selectionHandleColor
    selectionHandleKnobPaint.color = themePalette.selectionHandleColor
    placeholderPaint.color = themePalette.placeholderColor
    this.onWordSelected = onWordSelected
    this.onTextSelected = onTextSelected
    this.onSelectionCleared = onSelectionCleared
    this.onSelectionDragStateChanged = onSelectionDragStateChanged
    this.onEdgeAction = onEdgeAction
    if (this.focusModeEnabled != focusModeEnabled) {
      focusAnimator?.cancel()
      focusRanges = emptyList()
      previousFocusRanges = emptyList()
      focusTransition = 1f
    }
    this.focusModeEnabled = focusModeEnabled
    this.onFocusTextTapped = onFocusTextTapped
    updateHighlights(
      activeSelectionRanges = activeSelectionRanges,
      activeSelectionKind = activeSelectionKind,
      savedHighlightRanges = savedHighlightRanges,
      levelRanges = levelRanges,
      activeHighlightColor = activeHighlightColor,
      textSelectionHighlightColor = textSelectionHighlightColor,
      savedHighlightColor = savedHighlightColor,
      savedHighlightTextColor = savedHighlightTextColor,
      levelUnderlineEasyColor = levelUnderlineEasyColor,
      levelUnderlineMidColor = levelUnderlineMidColor,
      levelUnderlineHardColor = levelUnderlineHardColor
    )
    geometryDirty = true
    invalidate()
    postInvalidateOnAnimation()
  }

  fun updateHighlights(
    activeSelectionRanges: List<TextRange>,
    activeSelectionKind: ActiveSelectionKind?,
    savedHighlightRanges: List<TextRange>,
    levelRanges: List<TextRange>,
    activeHighlightColor: Int,
    textSelectionHighlightColor: Int,
    savedHighlightColor: Int,
    savedHighlightTextColor: Int,
    levelUnderlineEasyColor: Int,
    levelUnderlineMidColor: Int,
    levelUnderlineHardColor: Int
  ) {
    this.activeSelectionRanges = activeSelectionRanges
    this.activeSelectionKind = activeSelectionKind
    this.savedHighlightRanges = savedHighlightRanges
    this.levelRanges = levelRanges
    this.activeHighlightColor = activeHighlightColor
    this.textSelectionHighlightColor = textSelectionHighlightColor
    this.savedHighlightColor = savedHighlightColor
    this.savedHighlightTextColor = savedHighlightTextColor
    this.levelUnderlineEasyColor = levelUnderlineEasyColor
    this.levelUnderlineMidColor = levelUnderlineMidColor
    this.levelUnderlineHardColor = levelUnderlineHardColor
    savedHighlightPaint.color = savedHighlightColor
    savedHighlightTextPaint.color = savedHighlightTextColor
    activeHighlightPaint.color = activePaintColor()
    invalidate()
    postInvalidateOnAnimation()
  }

  override fun onDraw(canvas: Canvas) {
    canvas.drawColor(pageBackgroundColor)
    val contentWidth = width - (paddingH * 2)
    if (contentWidth <= 0) return
    drawPageBlocks(canvas, contentWidth)
    drawReaderEdgeState(canvas)
  }

  private fun drawPageBlocks(canvas: Canvas, contentWidth: Int) {
    var yOffset = paddingV.toFloat()

    page?.blocks?.forEach { block ->
      yOffset += block.marginTop

      if (block.type == "image") {
        val blockWidth = block.contentWidth.takeIf { it > 0 } ?: contentWidth
        val imageX = (paddingH + block.marginLeft).toFloat()
        if (focusModeEnabled) {
          val dimLayer = canvas.saveLayerAlpha(
            imageX,
            yOffset,
            imageX + blockWidth,
            yOffset + block.imageHeight,
            (FOCUS_DIM_ALPHA * 255).roundToInt()
          )
          drawImage(canvas, block, imageX, yOffset, blockWidth)
          canvas.restoreToCount(dimLayer)
        } else {
          drawImage(canvas, block, imageX, yOffset, blockWidth)
        }
        yOffset += block.imageHeight
      } else {
        val layout = block.textLayout ?: buildFallbackTextLayout(block, contentWidth) ?: return@forEach

        canvas.save()
        canvas.translate((paddingH + block.marginLeft).toFloat(), yOffset)
        if (focusModeEnabled) {
          drawFocusModeBlock(canvas, block, layout)
        } else {
          drawBlockContent(canvas, block, layout)
        }
        drawSelectionHandles(canvas, block, layout)
        canvas.restore()

        yOffset += layout.height
      }

      yOffset += block.marginBottom
    }
  }

  private fun drawBlockContent(canvas: Canvas, block: PageBlock, layout: StaticLayout) {
    activeHighlightPaint.color = activePaintColor()
    drawTextHighlights(canvas, block, layout, activeSelectionRanges, activeHighlightPaint)
    drawTextHighlights(canvas, block, layout, levelRanges, levelMarkPaint)
    drawTextHighlights(canvas, block, layout, savedHighlightRanges, savedHighlightPaint)
    layout.draw(canvas)
    drawSavedHighlightText(canvas, block, layout, savedHighlightRanges)
    if (showPinyin) {
      drawPinyinAnnotations(canvas, block, layout)
    }
  }

  // Draw each underlined word's pinyin, centered above the word, into the row of
  // space the paginator reserved above the line. Chinese only (only level ranges
  // carry pinyin) and only when the toggle is on.
  private fun drawPinyinAnnotations(canvas: Canvas, block: PageBlock, layout: StaticLayout) {
    if (levelRanges.isEmpty()) return
    val currentPage = page ?: return
    val blockTextLength = blockTextForSelection(block).length
    if (blockTextLength <= 0) return
    val bodyPaint = block.textPaint ?: return

    pinyinPaint.textSize = bodyPaint.textSize * 0.55f
    pinyinPaint.color = themePalette.subtleTextColor
    val ascent = bodyPaint.fontMetrics.ascent
    var drawnCount = 0
    var firstBaseline = -1f

    levelRanges.forEach { range ->
      val pinyin = range.pinyin?.takeIf { it.isNotBlank() } ?: return@forEach
      if (
        range.pageIndex != currentPage.pageIndex ||
        range.spineIndex != currentPage.spineIndex ||
        range.blockId != block.blockId
      ) {
        return@forEach
      }

      val blockSourceStart = block.sourceStartOffset
      val blockSourceEnd = blockSourceStart + blockTextLength
      val localStart = (max(range.sourceStartOffset, blockSourceStart) - blockSourceStart)
        .coerceIn(0, blockTextLength)
      val localEnd = (min(range.sourceEndOffset, blockSourceEnd) - blockSourceStart)
        .coerceIn(localStart, blockTextLength)
      if (localStart >= localEnd) {
        return@forEach
      }

      // Annotate above the first line the word sits on (words rarely wrap).
      val line = layout.getLineForOffset(localStart)
      val lineEnd = min(localEnd, layout.getLineEnd(line))
      val startX = layout.getPrimaryHorizontal(localStart)
      val endX = layout.getPrimaryHorizontal(max(localStart, lineEnd))
      val centerX = (min(startX, endX) + max(startX, endX)) / 2f

      // Sit the pinyin's baseline just above the word's glyph tops, in the reserved gap.
      val glyphTop = layout.getLineBaseline(line) + ascent
      val baseline = glyphTop - dp(1f) - pinyinPaint.descent()
      canvas.drawText(pinyin, centerX, baseline, pinyinPaint)
      if (drawnCount == 0) firstBaseline = baseline
      drawnCount++
    }
    if (drawnCount > 0) {
      android.util.Log.d("NativeEpubReader", "drawPinyin: block drew $drawnCount, firstBaseline=$firstBaseline, size=${pinyinPaint.textSize}, color=${pinyinPaint.color}")
    }
  }

  // Focus mode: draw the whole block dimmed, then re-draw the focused sentence
  // span(s) at full opacity clipped to their glyph bounds. During a focus shift
  // the outgoing span fades down while the incoming span fades up (300ms).
  private fun drawFocusModeBlock(canvas: Canvas, block: PageBlock, layout: StaticLayout) {
    val layoutWidth = layout.width.toFloat().coerceAtLeast(1f)
    val layoutHeight = layout.height.toFloat().coerceAtLeast(1f)
    val dimLayer = canvas.saveLayerAlpha(
      0f,
      0f,
      layoutWidth,
      layoutHeight,
      (FOCUS_DIM_ALPHA * 255).roundToInt()
    )
    drawBlockContent(canvas, block, layout)
    canvas.restoreToCount(dimLayer)

    if (focusTransition < 1f) {
      drawFocusOverlay(canvas, block, layout, previousFocusRanges, 1f - focusTransition)
    }
    drawFocusOverlay(canvas, block, layout, focusRanges, focusTransition)
  }

  private fun drawFocusOverlay(
    canvas: Canvas,
    block: PageBlock,
    layout: StaticLayout,
    ranges: List<FocusRange>,
    alpha: Float
  ) {
    if (alpha <= 0.01f) return

    val textLength = blockTextForSelection(block).length
    if (textLength <= 0) return

    focusClipPath.reset()
    var hasClip = false
    ranges.forEach { range ->
      if (range.blockId != block.blockId) return@forEach
      val localStart = range.startOffset.coerceIn(0, textLength)
      val localEnd = range.endOffset.coerceIn(localStart, textLength)
      if (localStart >= localEnd) return@forEach
      focusRangePath.reset()
      layout.getSelectionPath(localStart, localEnd, focusRangePath)
      focusClipPath.addPath(focusRangePath)
      hasClip = true
    }
    if (!hasClip || focusClipPath.isEmpty) return

    val layoutWidth = layout.width.toFloat().coerceAtLeast(1f)
    val layoutHeight = layout.height.toFloat().coerceAtLeast(1f)
    val clipSave = canvas.save()
    canvas.clipPath(focusClipPath)
    val overlayLayer = canvas.saveLayerAlpha(
      0f,
      0f,
      layoutWidth,
      layoutHeight,
      (alpha.coerceIn(0f, 1f) * 255).roundToInt()
    )
    drawBlockContent(canvas, block, layout)
    // Faux medium weight: a hairline-offset second pass thickens the focused
    // glyphs slightly, standing in for the design's 400 → 500 weight bump.
    canvas.translate(FOCUS_EMPHASIS_OFFSET_DP * resources.displayMetrics.density, 0f)
    layout.draw(canvas)
    canvas.translate(-FOCUS_EMPHASIS_OFFSET_DP * resources.displayMetrics.density, 0f)
    drawSavedHighlightText(canvas, block, layout, savedHighlightRanges)
    canvas.restoreToCount(overlayLayer)
    canvas.restoreToCount(clipSave)
  }

  fun setFocusHighlight(ranges: List<FocusRange>, animate: Boolean, fast: Boolean = false) {
    if (ranges == focusRanges) {
      return
    }

    focusAnimator?.cancel()
    if (!animate) {
      previousFocusRanges = emptyList()
      focusRanges = ranges
      focusTransition = 1f
      invalidate()
      postInvalidateOnAnimation()
      return
    }

    previousFocusRanges = focusRanges
    focusRanges = ranges
    focusTransition = 0f
    focusAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = if (fast) FOCUS_TRANSITION_FAST_DURATION_MS else FOCUS_TRANSITION_DURATION_MS
      interpolator = PathInterpolator(0.25f, 0.1f, 0.25f, 1f)
      addUpdateListener { animator ->
        focusTransition = animator.animatedValue as Float
        invalidate()
      }
      start()
    }
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        tapStartX = event.x
        tapStartY = event.y
        hitTestSelectionHandle(event.x, event.y)?.let { handle ->
          activeSelectionHandle = handle
          handleDragStartRanges = activeSelectionRanges
          isTapCandidate = false
          cancelPendingLongPress()
          parent?.requestDisallowInterceptTouchEvent(true)
          onSelectionDragStateChanged?.invoke(true)
          return true
        }

        isTapCandidate = true
        scheduleLongPress()
        return true
      }
      MotionEvent.ACTION_MOVE -> {
        activeSelectionHandle?.let { handle ->
          updateHandleSelection(handle, event.x, event.y)
          return true
        }

        if (isSelectionMode) {
          updateDragSelection(event.x, event.y)
          return true
        }

        val dx = abs(event.x - tapStartX)
        val dy = abs(event.y - tapStartY)

        if (
          dx > touchSlop ||
          dy > touchSlop
        ) {
          isTapCandidate = false
          cancelPendingLongPress()
        }

        if (dy > touchSlop && dy > dx) {
          parent?.requestDisallowInterceptTouchEvent(false)
          return false
        }
      }
      MotionEvent.ACTION_UP -> {
        cancelPendingLongPress()
        if (activeSelectionHandle != null) {
          finishHandleSelection(cancelled = false)
          return true
        }

        if (isSelectionMode) {
          finishDragSelection(cancelled = false)
          return true
        }

        if (isTapCandidate) {
          performClick()
          page?.edgeState?.let { edgeState ->
            if (edgeActionBoundsForKind(edgeState.kind).contains(event.x, event.y)) {
              onEdgeAction?.invoke(edgeState.kind)
              isTapCandidate = false
              return true
            }
          }

          // While the lookup panel is open in focus mode, a tap anywhere on
          // the reading surface only dismisses the panel — it must not move
          // the beam or select a new word (mirrors paged-mode behavior).
          if (focusModeEnabled && focusPanelOpen) {
            clearSelectionFromTap()
            isTapCandidate = false
            return true
          }

          if (!focusModeEnabled && activeSelectionKind != null && activeSelectionRanges.isNotEmpty()) {
            if (!hitTestActiveSelectionHighlight(event.x, event.y)) {
              clearSelectionFromTap()
            }
            isTapCandidate = false
            return true
          }

          val hit = hitTestText(event.x, event.y)
          if (hit != null) {
            if (focusModeEnabled) {
              // Word taps move the beam to the word's sentence; the lookup panel
              // always slides up from the bottom in focus mode.
              onFocusTextTapped?.invoke(hit.range.blockId, hit.localStartOffset)
              onWordSelected?.invoke(hit.copy(placement = "bottom"))
            } else {
              onWordSelected?.invoke(hit)
            }
          } else {
            if (focusModeEnabled) {
              // A tap on a sentence's blank space still moves the beam there.
              hitTestTextPosition(event.x, event.y, allowClosest = false)?.let { position ->
                onFocusTextTapped?.invoke(position.block.blockId, position.localOffset)
              }
            }
            onSelectionCleared?.invoke()
          }
        }
        isTapCandidate = false
      }
      MotionEvent.ACTION_CANCEL -> {
        cancelPendingLongPress()
        if (activeSelectionHandle != null) {
          finishHandleSelection(cancelled = true)
        }
        if (isSelectionMode) {
          finishDragSelection(cancelled = true)
        }
        isTapCandidate = false
      }
    }

    return true
  }

  private fun clearSelectionFromTap() {
    activeSelectionRanges = emptyList()
    activeSelectionKind = null
    activeHighlightPaint.color = activePaintColor()
    invalidate()
    postInvalidateOnAnimation()
    onSelectionCleared?.invoke()
  }

  override fun performClick(): Boolean {
    super.performClick()
    return true
  }

  private fun drawReaderEdgeState(canvas: Canvas) {
    val edgeState = page?.edgeState ?: return
    if (width <= 0 || height <= 0) return

    when (edgeState.kind) {
      ReaderEdgeKind.BOOK_FINISHED -> drawBookFinishedState(canvas, edgeState)
    }
  }

  private fun drawBookFinishedState(canvas: Canvas, edgeState: ReaderEdgeState) {
    val buttonRect = edgeActionBoundsForKind(edgeState.kind)
    drawSlateButton(canvas, buttonRect)

    val buttonLabelPaint = edgeTextPaint(
      sizeSp = 11f,
      color = readerEdgeButtonTextColor(),
      typeface = edgeSansBoldTypeface,
      letterSpacingEm = 0.16f
    )
    drawCenteredButtonTextWithBookIcon(canvas, "BACK TO LIBRARY", buttonRect, buttonLabelPaint)

    val metaPaint = edgeTextPaint(
      sizeSp = 13f,
      color = readerEdgeMutedTextColor(),
      typeface = edgeSansRegularTypeface
    )
    val titlePaint = edgeTextPaint(
      sizeSp = 28f,
      color = readerEdgeTextColor(),
      typeface = edgeDisplayTypeface
    )
    val labelPaint = edgeTextPaint(
      sizeSp = 10f,
      color = readerEdgeSubtleTextColor(),
      typeface = edgeSansMediumTypeface,
      letterSpacingEm = 0.26f
    )
    val buttonTop = buttonRect.top
    val metaCenterY = buttonTop - dp(31f)
    val titleCenterY = metaCenterY - dp(44f)
    val labelCenterY = titleCenterY - dp(45f)
    val iconCenterY = labelCenterY - dp(43f)
    val centerX = width / 2f

    drawBookFinishedIcon(canvas, centerX, iconCenterY, dp(54f).toFloat())
    drawCenteredText(canvas, "BOOK FINISHED", labelCenterY, labelPaint, width - dp(48f))
    drawCenteredText(canvas, edgeState.bookTitle.ifBlank { edgeState.chapterTitle }, titleCenterY, titlePaint, width - dp(64f))
    drawCenteredText(
      canvas,
      bookFinishedMeta(edgeState.chapterCount, edgeState.savedWordCount),
      metaCenterY,
      metaPaint,
      width - dp(64f)
    )

    val reviewPaint = edgeTextPaint(
      sizeSp = 12f,
      color = readerEdgeReviewTextColor(),
      typeface = edgeSansMediumTypeface,
      letterSpacingEm = 0.12f
    )
    drawCenteredText(
      canvas,
      bookReviewLabel(edgeState.savedWordCount),
      buttonRect.bottom + dp(34f),
      reviewPaint,
      width - dp(64f)
    )
  }

  private fun drawSlateButton(canvas: Canvas, rect: RectF) {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = readerEdgeButtonColor()
      style = Paint.Style.FILL
    }
    val radius = dp(4f).toFloat()
    canvas.drawRoundRect(rect, radius, radius, paint)
  }

  private fun drawCenteredButtonTextWithBookIcon(
    canvas: Canvas,
    label: String,
    rect: RectF,
    paint: TextPaint
  ) {
    val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = readerEdgeButtonTextColor()
      style = Paint.Style.STROKE
      strokeWidth = dp(1.7f).toFloat()
      strokeCap = Paint.Cap.ROUND
      strokeJoin = Paint.Join.ROUND
    }
    val iconSize = dp(20f).toFloat()
    val gap = dp(14f).toFloat()
    val labelPaint = TextPaint(paint).apply {
      textAlign = Paint.Align.LEFT
    }
    val labelWidth = labelPaint.measureText(label)
    val totalWidth = iconSize + gap + labelWidth
    val iconCenterX = rect.centerX() - (totalWidth / 2f) + (iconSize / 2f)
    val baseline = baselineForCenter(rect.centerY(), labelPaint)
    val labelX = iconCenterX + (iconSize / 2f) + gap

    drawOpenBookIcon(canvas, iconCenterX, rect.centerY(), iconSize, iconPaint)
    canvas.drawText(label, labelX, baseline, labelPaint)
  }

  private fun drawBookFinishedIcon(
    canvas: Canvas,
    centerX: Float,
    centerY: Float,
    targetWidth: Float
  ) {
    val bitmap = bookFinishedIconBitmap
    if (bitmap == null || bitmap.width <= 0 || bitmap.height <= 0) {
      val fallbackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = readerEdgeTextColor()
        style = Paint.Style.STROKE
        strokeWidth = dp(2.1f).toFloat()
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
      }
      drawOpenBookIcon(canvas, centerX, centerY, dp(38f).toFloat(), fallbackPaint)
      return
    }

    val targetHeight = targetWidth * (bitmap.height.toFloat() / bitmap.width.toFloat())
    bookFinishedIconRect.set(
      centerX - (targetWidth / 2f),
      centerY - (targetHeight / 2f),
      centerX + (targetWidth / 2f),
      centerY + (targetHeight / 2f)
    )
    canvas.drawBitmap(bitmap, null, bookFinishedIconRect, bookFinishedIconPaint)
  }

  private fun drawOpenBookIcon(
    canvas: Canvas,
    centerX: Float,
    centerY: Float,
    size: Float,
    paint: Paint
  ) {
    val half = size / 2f
    val top = centerY - (size * 0.38f)
    val bottom = centerY + (size * 0.38f)
    val centerTop = top + (size * 0.17f)
    val centerBottom = bottom - (size * 0.08f)
    val outerLeft = centerX - half
    val outerRight = centerX + half
    val innerGap = size * 0.12f

    edgeIconPath.reset()
    edgeIconPath.moveTo(centerX - innerGap, centerTop)
    edgeIconPath.cubicTo(
      centerX - (size * 0.28f),
      top,
      outerLeft,
      top + (size * 0.04f),
      outerLeft,
      top + (size * 0.24f)
    )
    edgeIconPath.lineTo(outerLeft, bottom)
    edgeIconPath.cubicTo(
      outerLeft + (size * 0.24f),
      bottom - (size * 0.09f),
      centerX - (size * 0.18f),
      bottom,
      centerX - innerGap,
      centerBottom
    )

    edgeIconPath.moveTo(centerX + innerGap, centerTop)
    edgeIconPath.cubicTo(
      centerX + (size * 0.28f),
      top,
      outerRight,
      top + (size * 0.04f),
      outerRight,
      top + (size * 0.24f)
    )
    edgeIconPath.lineTo(outerRight, bottom)
    edgeIconPath.cubicTo(
      outerRight - (size * 0.24f),
      bottom - (size * 0.09f),
      centerX + (size * 0.18f),
      bottom,
      centerX + innerGap,
      centerBottom
    )

    edgeIconPath.moveTo(centerX, top - (size * 0.06f))
    edgeIconPath.lineTo(centerX, bottom + (size * 0.06f))
    canvas.drawPath(edgeIconPath, paint)
  }

  private fun drawCenteredText(
    canvas: Canvas,
    text: String,
    centerY: Float,
    paint: TextPaint,
    maxWidth: Int
  ) {
    val displayText = TextUtils
      .ellipsize(text, paint, maxWidth.toFloat().coerceAtLeast(1f), TextUtils.TruncateAt.END)
      .toString()
    canvas.drawText(displayText, width / 2f, baselineForCenter(centerY, paint), paint)
  }

  private fun baselineForCenter(centerY: Float, paint: Paint): Float {
    val metrics = paint.fontMetrics
    return centerY - ((metrics.ascent + metrics.descent) / 2f)
  }

  private fun edgeActionBoundsForKind(kind: ReaderEdgeKind): RectF {
    return edgeActionBounds(
      bottomInsetDp = if (kind == ReaderEdgeKind.BOOK_FINISHED) 48f else 28f
    )
  }

  private fun edgeActionBounds(bottomInsetDp: Float): RectF {
    val horizontalInset = dp(24f).toFloat()
    val buttonBottom = height - dp(bottomInsetDp).toFloat()
    val buttonHeight = dp(60f).toFloat()
    edgeButtonRect.set(
      horizontalInset,
      buttonBottom - buttonHeight,
      width - horizontalInset,
      buttonBottom
    )
    return edgeButtonRect
  }

  private fun edgeTextPaint(
    sizeSp: Float,
    color: Int,
    typeface: Typeface,
    letterSpacingEm: Float = 0f
  ): TextPaint {
    return TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      this.color = color
      textSize = sp(sizeSp)
      this.typeface = typeface
      textAlign = Paint.Align.CENTER
      letterSpacing = letterSpacingEm
    }
  }

  private fun bookFinishedMeta(chapterCount: Int, savedWordCount: Int): String {
    val safeChapterCount = chapterCount.coerceAtLeast(0)
    val safeSavedWordCount = savedWordCount.coerceAtLeast(0)
    val chapterNoun = if (safeChapterCount == 1) "chapter" else "chapters"
    val wordNoun = if (safeSavedWordCount == 1) "word" else "words"
    return "$safeChapterCount $chapterNoun · $safeSavedWordCount $wordNoun saved"
  }

  private fun bookReviewLabel(savedWordCount: Int): String {
    val safeSavedWordCount = savedWordCount.coerceAtLeast(0)
    val wordNoun = if (safeSavedWordCount == 1) "WORD" else "WORDS"
    return "REVIEW $safeSavedWordCount $wordNoun"
  }

  private fun readerEdgeTextColor(): Int {
    return themePalette.bodyTextColor
  }

  private fun readerEdgeMutedTextColor(): Int {
    return themePalette.mutedTextColor
  }

  private fun readerEdgeSubtleTextColor(): Int {
    return themePalette.subtleTextColor
  }

  private fun readerEdgeRuleColor(): Int {
    return themePalette.ruleColor
  }

  private fun readerEdgeButtonColor(): Int {
    return themePalette.edgeButtonColor
  }

  private fun readerEdgeButtonTextColor(): Int {
    return themePalette.edgeButtonTextColor
  }

  private fun readerEdgeReviewTextColor(): Int {
    return if (themePalette.backgroundColor == Color.rgb(0x11, 0x15, 0x1c)) {
      themePalette.mutedTextColor
    } else {
      Color.rgb(0x5c, 0x5e, 0x63)
    }
  }

  private fun scheduleLongPress() {
    cancelPendingLongPress()
    val runnable = Runnable {
      beginLongPressSelection(tapStartX, tapStartY)
    }
    longPressRunnable = runnable
    longPressHandler.postDelayed(runnable, longPressTimeout)
  }

  private fun cancelPendingLongPress() {
    longPressRunnable?.let { runnable ->
      longPressHandler.removeCallbacks(runnable)
    }
    longPressRunnable = null
  }

  private fun beginLongPressSelection(x: Float, y: Float) {
    val hit = hitTestText(x, y) ?: return
    val renderedIndex = renderedTextBlocks.indexOfFirst { rendered ->
      rendered.block.blockId == hit.range.blockId &&
        rendered.block.sourceStartOffset <= hit.range.sourceStartOffset &&
        rendered.block.sourceStartOffset + blockTextForSelection(rendered.block).length >= hit.range.sourceEndOffset
    }

    if (renderedIndex < 0) {
      return
    }

    val block = renderedTextBlocks[renderedIndex].block
    // Default the long-press selection to the whole sentence the word sits in,
    // so the reader immediately sees the entire sentence translated. The drag
    // handles still let them narrow or widen the range afterward. Falls back to
    // just the tapped word if no sentence bounds can be resolved.
    val sentenceBounds = sentenceBoundsAtOffset(block, hit.localStartOffset, hit.localEndOffset)
    val selStart = sentenceBounds?.first ?: hit.localStartOffset
    val selEnd = sentenceBounds?.second ?: hit.localEndOffset

    isTapCandidate = false
    isSelectionMode = true
    parent?.requestDisallowInterceptTouchEvent(true)
    onSelectionDragStateChanged?.invoke(true)
    selectionAnchor = SelectionAnchor(
      pageIndex = hit.range.pageIndex,
      spineIndex = hit.range.spineIndex,
      blockId = hit.range.blockId,
      renderedIndex = renderedIndex,
      localStartOffset = selStart,
      localEndOffset = selEnd,
      sourceStartOffset = block.sourceStartOffset + selStart,
      sourceEndOffset = block.sourceStartOffset + selEnd
    )
    activeSelectionRanges = listOf(
      TextRange(
        pageIndex = hit.range.pageIndex,
        spineIndex = hit.range.spineIndex,
        blockId = hit.range.blockId,
        sourceStartOffset = block.sourceStartOffset + selStart,
        sourceEndOffset = block.sourceStartOffset + selEnd
      )
    )
    activeSelectionKind = ActiveSelectionKind.TEXT
    activeHighlightPaint.color = activePaintColor()
    invalidate()
    postInvalidateOnAnimation()
  }

  private fun updateDragSelection(x: Float, y: Float) {
    val anchor = selectionAnchor ?: return
    val focus = hitTestTextPosition(x, y, allowClosest = true) ?: return
    val ranges = buildSelectionRanges(anchor, focus)

    if (ranges.isNotEmpty()) {
      activeSelectionRanges = ranges
      activeSelectionKind = ActiveSelectionKind.TEXT
      activeHighlightPaint.color = activePaintColor()
      invalidate()
      postInvalidateOnAnimation()
    }
  }

  private fun updateHandleSelection(handle: SelectionHandle, x: Float, y: Float) {
    val endpoints = activeTextSelectionEndpoints() ?: return
    val focus = hitTestTextPosition(x, y, allowClosest = true) ?: return
    val ranges = when (handle) {
      SelectionHandle.START -> buildSelectionRangesBetween(focus, endpoints.second)
      SelectionHandle.END -> buildSelectionRangesBetween(endpoints.first, focus)
    }

    if (ranges.isNotEmpty()) {
      activeSelectionRanges = ranges
      activeSelectionKind = ActiveSelectionKind.TEXT
      activeHighlightPaint.color = activePaintColor()
      invalidate()
      postInvalidateOnAnimation()
    }
  }

  private fun finishDragSelection(cancelled: Boolean) {
    parent?.requestDisallowInterceptTouchEvent(false)
    onSelectionDragStateChanged?.invoke(false)

    if (!cancelled) {
      val selectedText = selectedTextForRanges(activeSelectionRanges)
      if (selectedText.isNotBlank() && activeSelectionRanges.isNotEmpty()) {
        onTextSelected?.invoke(
          TextSelectionHit(
            text = selectedText,
            placement = placementForRanges(activeSelectionRanges),
            ranges = activeSelectionRanges
          )
        )
      } else {
        activeSelectionRanges = emptyList()
        activeSelectionKind = null
        onSelectionCleared?.invoke()
      }
    } else {
      activeSelectionRanges = emptyList()
      activeSelectionKind = null
      invalidate()
      postInvalidateOnAnimation()
    }

    isSelectionMode = false
    selectionAnchor = null
    isTapCandidate = false
  }

  private fun finishHandleSelection(cancelled: Boolean) {
    parent?.requestDisallowInterceptTouchEvent(false)
    onSelectionDragStateChanged?.invoke(false)

    if (cancelled) {
      activeSelectionRanges = handleDragStartRanges
      activeSelectionKind = if (activeSelectionRanges.isNotEmpty()) ActiveSelectionKind.TEXT else null
      invalidate()
      postInvalidateOnAnimation()
    } else {
      val selectedText = selectedTextForRanges(activeSelectionRanges)
      if (selectedText.isNotBlank() && activeSelectionRanges.isNotEmpty()) {
        onTextSelected?.invoke(
          TextSelectionHit(
            text = selectedText,
            placement = placementForRanges(activeSelectionRanges),
            ranges = activeSelectionRanges
          )
        )
      } else {
        activeSelectionRanges = emptyList()
        activeSelectionKind = null
        onSelectionCleared?.invoke()
      }
    }

    activeSelectionHandle = null
    handleDragStartRanges = emptyList()
    isTapCandidate = false
  }

  private fun activePaintColor(): Int {
    return if (isSelectionMode || activeSelectionKind == ActiveSelectionKind.TEXT) {
      textSelectionHighlightColor
    } else {
      activeHighlightColor
    }
  }

  fun hitTestText(tapX: Float, tapY: Float): WordHit? {
    if (geometryDirty) {
      rebuildGeometry()
    }

    val currentPage = page
    if (currentPage == null || renderedTextBlocks.isEmpty()) {
      Log.d(PAGE_VIEW_TAG, "word hit no-hit: reason=outside text")
      return null
    }

    renderedTextBlocks.forEach { rendered ->
      val layout = rendered.layout
      val block = rendered.block
      val blockBottom = rendered.y + layout.height

      if (tapY < rendered.y || tapY > blockBottom) {
        return@forEach
      }

      if (tapX < rendered.x || tapX > rendered.x + rendered.width) {
        Log.d(PAGE_VIEW_TAG, "word hit no-hit: reason=margin block=${block.blockId}")
        return null
      }

      if (layout.lineCount <= 0 || layout.height <= 0) {
        Log.d(PAGE_VIEW_TAG, "word hit no-hit: reason=blank space block=${block.blockId}")
        return null
      }

      val localX = tapX - rendered.x
      val localY = tapY - rendered.y
      val line = layout.getLineForVertical(localY.toInt().coerceIn(0, layout.height - 1))
      val horizontalTolerance = dp(4f).toFloat()
      val lineLeft = layout.getLineLeft(line)
      val lineRight = layout.getLineRight(line)

      if (localX < lineLeft - horizontalTolerance || localX > lineRight + horizontalTolerance) {
        Log.d(PAGE_VIEW_TAG, "word hit no-hit: reason=blank space block=${block.blockId}")
        return null
      }

      val localOffset = layout.getOffsetForHorizontal(line, localX)
      val blockText = blockTextForSelection(block)
      val tokenRange = tokenRangeAtOffset(blockText, localOffset)

      if (tokenRange == null) {
        Log.d(
          PAGE_VIEW_TAG,
          "word hit no-hit: reason=blank space block=${block.blockId} localOffset=$localOffset"
        )
        return null
      }

      val sourceStart = block.sourceStartOffset + tokenRange.start
      val sourceEnd = block.sourceStartOffset + tokenRange.end
      val word = blockText.substring(tokenRange.start, tokenRange.end)
      val wordCenterY = wordCenterY(rendered, layout, tokenRange, line)
      val placement = if (usesTopLookupPlacement(wordCenterY)) "top" else "bottom"
      val range = TextRange(
        pageIndex = currentPage.pageIndex,
        spineIndex = currentPage.spineIndex,
        blockId = block.blockId,
        sourceStartOffset = sourceStart,
        sourceEndOffset = sourceEnd
      )

      Log.d(
        PAGE_VIEW_TAG,
        "word hit success: page=${currentPage.pageIndex} spine=${currentPage.spineIndex ?: "none"} " +
          "block=${block.blockId} local=${tokenRange.start}..${tokenRange.end} " +
          "source=$sourceStart..$sourceEnd text=$word"
      )

      return WordHit(
        text = word,
        placement = placement,
        range = range,
        localStartOffset = tokenRange.start,
        localEndOffset = tokenRange.end,
        sentence = sentenceForToken(blockText, tokenRange)
      )
    }

    Log.d(PAGE_VIEW_TAG, "word hit no-hit: reason=${describeNoHitArea(tapX, tapY)}")
    return null
  }

  private fun hitTestTextPosition(
    tapX: Float,
    tapY: Float,
    allowClosest: Boolean
  ): TextPosition? {
    if (geometryDirty) {
      rebuildGeometry()
    }

    if (renderedTextBlocks.isEmpty()) {
      return null
    }

    renderedTextBlocks.forEachIndexed { index, rendered ->
      val layout = rendered.layout
      val block = rendered.block
      val blockBottom = rendered.y + layout.height

      if (tapY < rendered.y || tapY > blockBottom || layout.lineCount <= 0) {
        return@forEachIndexed
      }

      val text = blockTextForSelection(block)
      if (text.isEmpty()) {
        return null
      }

      val localY = tapY - rendered.y
      val line = layout.getLineForVertical(localY.toInt().coerceIn(0, layout.height - 1))
      val localX = (tapX - rendered.x).coerceIn(layout.getLineLeft(line), layout.getLineRight(line))
      val localOffset = layout.getOffsetForHorizontal(line, localX).coerceIn(0, text.length)

      return TextPosition(
        renderedIndex = index,
        block = block,
        localOffset = localOffset,
        sourceOffset = block.sourceStartOffset + localOffset
      )
    }

    if (!allowClosest) {
      return null
    }

    val closestIndex = when {
      tapY <= renderedTextBlocks.first().y -> 0
      tapY >= renderedTextBlocks.last().y + renderedTextBlocks.last().layout.height -> renderedTextBlocks.lastIndex
      else -> renderedTextBlocks
        .withIndex()
        .minByOrNull { (_, rendered) ->
          min(abs(tapY - rendered.y), abs(tapY - (rendered.y + rendered.layout.height)))
        }
        ?.index ?: return null
    }
    val rendered = renderedTextBlocks[closestIndex]
    val blockText = blockTextForSelection(rendered.block)
    val localOffset = if (tapY < rendered.y) 0 else blockText.length

    return TextPosition(
      renderedIndex = closestIndex,
      block = rendered.block,
      localOffset = localOffset,
      sourceOffset = rendered.block.sourceStartOffset + localOffset
    )
  }

  private fun buildSelectionRanges(
    anchor: SelectionAnchor,
    focus: TextPosition
  ): List<TextRange> {
    val currentPage = page ?: return emptyList()
    val startIndex = min(anchor.renderedIndex, focus.renderedIndex)
    val endIndex = max(anchor.renderedIndex, focus.renderedIndex)
    val forward = focus.renderedIndex > anchor.renderedIndex ||
      (focus.renderedIndex == anchor.renderedIndex && focus.sourceOffset >= anchor.sourceStartOffset)
    val ranges = mutableListOf<TextRange>()

    for (index in startIndex..endIndex) {
      val block = renderedTextBlocks.getOrNull(index)?.block ?: continue
      val blockText = blockTextForSelection(block)
      val blockLength = blockText.length
      if (blockLength <= 0) continue

      val localStart: Int
      val localEnd: Int

      if (anchor.renderedIndex == focus.renderedIndex) {
        localStart = min(anchor.localStartOffset, focus.localOffset).coerceIn(0, blockLength)
        localEnd = max(anchor.localEndOffset, focus.localOffset).coerceIn(localStart, blockLength)
      } else if (forward) {
        localStart = if (index == anchor.renderedIndex) anchor.localStartOffset else 0
        localEnd = if (index == focus.renderedIndex) focus.localOffset else blockLength
      } else {
        localStart = if (index == focus.renderedIndex) focus.localOffset else 0
        localEnd = if (index == anchor.renderedIndex) anchor.localEndOffset else blockLength
      }

      if (localStart < localEnd) {
        ranges.add(
          TextRange(
            pageIndex = currentPage.pageIndex,
            spineIndex = currentPage.spineIndex,
            blockId = block.blockId,
            sourceStartOffset = block.sourceStartOffset + localStart,
            sourceEndOffset = block.sourceStartOffset + localEnd
          )
        )
      }
    }

    return ranges
  }

  private fun buildSelectionRangesBetween(
    firstPosition: TextPosition,
    secondPosition: TextPosition
  ): List<TextRange> {
    val currentPage = page ?: return emptyList()
    val orderedPositions = if (compareTextPositions(firstPosition, secondPosition) <= 0) {
      firstPosition to secondPosition
    } else {
      secondPosition to firstPosition
    }
    val startPosition = orderedPositions.first
    val endPosition = orderedPositions.second
    val ranges = mutableListOf<TextRange>()

    for (index in startPosition.renderedIndex..endPosition.renderedIndex) {
      val block = renderedTextBlocks.getOrNull(index)?.block ?: continue
      val blockText = blockTextForSelection(block)
      val blockLength = blockText.length
      if (blockLength <= 0) continue

      val localStart = if (index == startPosition.renderedIndex) {
        startPosition.localOffset.coerceIn(0, blockLength)
      } else {
        0
      }
      val localEnd = if (index == endPosition.renderedIndex) {
        endPosition.localOffset.coerceIn(localStart, blockLength)
      } else {
        blockLength
      }

      if (localStart < localEnd) {
        ranges.add(
          TextRange(
            pageIndex = currentPage.pageIndex,
            spineIndex = currentPage.spineIndex,
            blockId = block.blockId,
            sourceStartOffset = block.sourceStartOffset + localStart,
            sourceEndOffset = block.sourceStartOffset + localEnd
          )
        )
      }
    }

    return ranges
  }

  private fun selectedTextForRanges(ranges: List<TextRange>): String {
    val builder = StringBuilder()

    ranges.forEach { range ->
      val rendered = renderedTextBlocks.firstOrNull { item ->
        item.block.blockId == range.blockId &&
          page?.pageIndex == range.pageIndex &&
          page?.spineIndex == range.spineIndex
      } ?: return@forEach
      val block = rendered.block
      val text = blockTextForSelection(block)
      val localStart = (range.sourceStartOffset - block.sourceStartOffset).coerceIn(0, text.length)
      val localEnd = (range.sourceEndOffset - block.sourceStartOffset).coerceIn(localStart, text.length)
      val selected = text.substring(localStart, localEnd).trim()

      if (selected.isNotEmpty()) {
        if (builder.isNotEmpty()) {
          builder.append('\n')
        }
        builder.append(selected)
      }
    }

    return builder.toString()
  }

  private fun activeTextSelectionEndpoints(): Pair<TextPosition, TextPosition>? {
    if (geometryDirty) {
      rebuildGeometry()
    }

    val ranges = sortedActiveTextSelectionRanges()
    val first = ranges.firstOrNull() ?: return null
    val last = ranges.lastOrNull() ?: return null
    val start = textPositionForRangeEndpoint(first, isStart = true) ?: return null
    val end = textPositionForRangeEndpoint(last, isStart = false) ?: return null

    return start to end
  }

  private fun sortedActiveTextSelectionRanges(): List<TextRange> {
    val currentPage = page ?: return emptyList()

    return activeSelectionRanges
      .filter { range ->
        range.pageIndex == currentPage.pageIndex &&
          range.spineIndex == currentPage.spineIndex
      }
      .sortedWith(
        compareBy<TextRange> { range -> renderedIndexForRange(range) }
          .thenBy { range -> range.sourceStartOffset }
          .thenBy { range -> range.sourceEndOffset }
      )
      .filter { range -> renderedIndexForRange(range) != Int.MAX_VALUE }
  }

  private fun renderedIndexForRange(range: TextRange): Int {
    return renderedTextBlocks.indexOfFirst { rendered ->
      rendered.block.blockId == range.blockId
    }.takeIf { it >= 0 } ?: Int.MAX_VALUE
  }

  private fun textPositionForRangeEndpoint(range: TextRange, isStart: Boolean): TextPosition? {
    val renderedIndex = renderedIndexForRange(range).takeIf { it != Int.MAX_VALUE } ?: return null
    val rendered = renderedTextBlocks.getOrNull(renderedIndex) ?: return null
    val block = rendered.block
    val blockText = blockTextForSelection(block)
    val sourceOffset = if (isStart) range.sourceStartOffset else range.sourceEndOffset
    val localOffset = (sourceOffset - block.sourceStartOffset).coerceIn(0, blockText.length)

    return TextPosition(
      renderedIndex = renderedIndex,
      block = block,
      localOffset = localOffset,
      sourceOffset = block.sourceStartOffset + localOffset
    )
  }

  private fun compareTextPositions(first: TextPosition, second: TextPosition): Int {
    return when {
      first.renderedIndex != second.renderedIndex -> first.renderedIndex.compareTo(second.renderedIndex)
      first.sourceOffset != second.sourceOffset -> first.sourceOffset.compareTo(second.sourceOffset)
      else -> first.localOffset.compareTo(second.localOffset)
    }
  }

  private fun snapFocusForAnchor(position: TextPosition, anchor: SelectionAnchor): TextPosition {
    val isForward = position.renderedIndex > anchor.renderedIndex ||
      (position.renderedIndex == anchor.renderedIndex && position.sourceOffset >= anchor.sourceStartOffset)

    return snappedPositionForHandle(
      position = position,
      handle = if (isForward) SelectionHandle.END else SelectionHandle.START
    )
  }

  private fun snappedPositionForHandle(position: TextPosition, handle: SelectionHandle): TextPosition {
    val text = blockTextForSelection(position.block)
    if (text.isEmpty()) {
      return position
    }

    val probeOffset = when (handle) {
      SelectionHandle.START -> position.localOffset
      SelectionHandle.END -> max(0, position.localOffset - 1)
    }.coerceIn(0, text.length)
    val tokenRange = tokenRangeAtOffset(text, probeOffset) ?: return position
    val snappedLocalOffset = when (handle) {
      SelectionHandle.START -> tokenRange.start
      SelectionHandle.END -> tokenRange.end
    }.coerceIn(0, text.length)

    return position.copy(
      localOffset = snappedLocalOffset,
      sourceOffset = position.block.sourceStartOffset + snappedLocalOffset
    )
  }

  private fun placementForRanges(ranges: List<TextRange>): String {
    val bounds = RectF()
    val blockBounds = RectF()
    var hasBounds = false

    ranges.forEach { range ->
      val rendered = renderedTextBlocks.firstOrNull { item ->
        item.block.blockId == range.blockId &&
          page?.pageIndex == range.pageIndex &&
          page?.spineIndex == range.spineIndex
      } ?: return@forEach
      val textLength = blockTextForSelection(rendered.block).length
      val localStart = (range.sourceStartOffset - rendered.block.sourceStartOffset).coerceIn(0, textLength)
      val localEnd = (range.sourceEndOffset - rendered.block.sourceStartOffset).coerceIn(localStart, textLength)
      if (localStart >= localEnd) return@forEach

      highlightPath.reset()
      blockBounds.setEmpty()
      rendered.layout.getSelectionPath(localStart, localEnd, highlightPath)
      highlightPath.computeBounds(blockBounds, true)
      if (blockBounds.isEmpty) return@forEach

      blockBounds.offset(rendered.x, rendered.y)
      if (hasBounds) {
        bounds.union(blockBounds)
      } else {
        bounds.set(blockBounds)
        hasBounds = true
      }
    }

    val centerY = if (hasBounds) bounds.centerY() else tapStartY
    return if (usesTopLookupPlacement(centerY)) "top" else "bottom"
  }

  private fun usesTopLookupPlacement(centerY: Float): Boolean {
    return height > 0 && centerY >= height * 0.5f
  }

  private fun rebuildGeometry() {
    val currentPage = page
    val contentWidth = width - (paddingH * 2)

    if (currentPage == null || contentWidth <= 0) {
      renderedTextBlocks = emptyList()
      geometryDirty = false
      return
    }

    val renderedBlocks = mutableListOf<RenderedTextBlock>()
    var yOffset = paddingV.toFloat()

    currentPage.blocks.forEach { block ->
      yOffset += block.marginTop

      if (block.type == "image") {
        yOffset += block.imageHeight
      } else {
        val layout = block.textLayout ?: buildFallbackTextLayout(block, contentWidth)
        if (layout != null) {
          renderedBlocks.add(
            RenderedTextBlock(
              block = block,
              layout = layout,
              x = (paddingH + block.marginLeft).toFloat(),
              y = yOffset,
              width = block.contentWidth.takeIf { it > 0 } ?: contentWidth
            )
          )
          yOffset += layout.height
        }
      }

      yOffset += block.marginBottom
    }

    renderedTextBlocks = renderedBlocks
    geometryDirty = false
  }

  private fun drawTextHighlights(
    canvas: Canvas,
    block: PageBlock,
    layout: StaticLayout,
    ranges: List<TextRange>,
    paint: Paint
  ) {
    val currentPage = page ?: return
    val blockTextLength = blockTextForSelection(block).length
    if (blockTextLength <= 0) return

    ranges.forEach { range ->
      if (
        range.pageIndex != currentPage.pageIndex ||
        range.spineIndex != currentPage.spineIndex ||
        range.blockId != block.blockId
      ) {
        return@forEach
      }

      val blockSourceStart = block.sourceStartOffset
      val blockSourceEnd = blockSourceStart + blockTextLength
      val localStart = max(range.sourceStartOffset, blockSourceStart) - blockSourceStart
      val localEnd = min(range.sourceEndOffset, blockSourceEnd) - blockSourceStart

      if (localStart >= localEnd) {
        return@forEach
      }

      if (paint === savedHighlightPaint) {
        drawTextSelectionHighlight(
          canvas = canvas,
          block = block,
          layout = layout,
          localStart = localStart,
          localEnd = localEnd,
          textLength = blockTextLength,
          paint = paint
        )
        return@forEach
      }

      if (paint === levelMarkPaint) {
        applyLevelUnderlineShade(paint, range.levelWeight, range.levelReinforced)
        drawLevelUnderline(canvas, layout, localStart, localEnd, blockTextLength, paint)
        return@forEach
      }

      if (
        paint === activeHighlightPaint &&
        (activeSelectionKind == ActiveSelectionKind.TEXT || activeSelectionKind == ActiveSelectionKind.WORD)
      ) {
        drawTextSelectionHighlight(
          canvas = canvas,
          block = block,
          layout = layout,
          localStart = localStart,
          localEnd = localEnd,
          textLength = blockTextLength,
          paint = paint
        )
      } else {
        highlightPath.reset()
        layout.getSelectionPath(
          localStart.coerceIn(0, blockTextLength),
          localEnd.coerceIn(0, blockTextLength),
          highlightPath
        )
        canvas.drawPath(highlightPath, paint)
      }
    }
  }

  private fun drawTextSelectionHighlight(
    canvas: Canvas,
    block: PageBlock,
    layout: StaticLayout,
    localStart: Int,
    localEnd: Int,
    textLength: Int,
    paint: Paint
  ) {
    val text = blockTextForSelection(block)
    val safeStart = localStart.coerceIn(0, textLength)
    val safeEnd = localEnd.coerceIn(safeStart, textLength)
    if (safeStart >= safeEnd || layout.lineCount <= 0) return

    val startLine = layout.getLineForOffset(safeStart)
    val endLine = layout.getLineForOffset(max(safeStart, safeEnd - 1))
    val horizontalPad = dp(1f).toFloat()
    val topPad = dp(12f).toFloat()
    val bottomPad = dp(5f).toFloat()
    val cornerRadius = dp(2f).toFloat()

    for (line in startLine..endLine) {
      val rawLineStart = layout.getLineStart(line).coerceIn(0, textLength)
      val rawLineEnd = layout.getLineEnd(line).coerceIn(rawLineStart, textLength)
      var lineStart = max(safeStart, rawLineStart)
      var lineEnd = min(safeEnd, rawLineEnd)

      while (lineStart < lineEnd && text[lineStart].isWhitespace()) {
        lineStart += 1
      }
      while (lineEnd > lineStart && text[lineEnd - 1].isWhitespace()) {
        lineEnd -= 1
      }
      if (lineStart >= lineEnd) continue

      val selectedThroughLineStart = safeStart <= rawLineStart
      val selectedThroughLineEnd = safeEnd >= rawLineEnd
      val startX = if (selectedThroughLineStart) {
        layout.getLineLeft(line)
      } else {
        layout.getPrimaryHorizontal(lineStart)
      }
      val endX = if (selectedThroughLineEnd) {
        layout.getLineRight(line)
      } else {
        layout.getPrimaryHorizontal(lineEnd)
      }
      val left = min(startX, endX) - horizontalPad
      val right = max(startX, endX) + horizontalPad
      if (right <= left) continue

      val verticalMetrics = selectionHighlightVerticalMetrics(
        layout = layout,
        line = line,
        textPaint = block.textPaint,
        topPad = topPad,
        bottomPad = bottomPad
      ) ?: continue
      val top = verticalMetrics.top
      val bottom = verticalMetrics.bottom
      if (bottom <= top) continue

      selectionLineRect.set(left, top, right, bottom)
      canvas.drawRoundRect(selectionLineRect, cornerRadius, cornerRadius, paint)
    }
  }

  private fun drawSavedHighlightText(
    canvas: Canvas,
    block: PageBlock,
    layout: StaticLayout,
    ranges: List<TextRange>
  ) {
    val currentPage = page ?: return
    val text = blockTextForSelection(block)
    val textLength = text.length
    if (textLength <= 0 || layout.lineCount <= 0 || ranges.isEmpty()) return

    val sourceStart = block.sourceStartOffset
    val sourceEnd = sourceStart + textLength
    val textPaint = TextPaint(block.textPaint ?: savedHighlightTextPaint).apply {
      color = savedHighlightTextColor
    }

    ranges.forEach { range ->
      if (
        range.pageIndex != currentPage.pageIndex ||
        range.spineIndex != currentPage.spineIndex ||
        range.blockId != block.blockId
      ) {
        return@forEach
      }

      val safeStart = (max(range.sourceStartOffset, sourceStart) - sourceStart).coerceIn(0, textLength)
      val safeEnd = (min(range.sourceEndOffset, sourceEnd) - sourceStart).coerceIn(safeStart, textLength)
      if (safeStart >= safeEnd) {
        return@forEach
      }

      val startLine = layout.getLineForOffset(safeStart)
      val endLine = layout.getLineForOffset(max(safeStart, safeEnd - 1))

      for (line in startLine..endLine) {
        val rawLineStart = layout.getLineStart(line).coerceIn(0, textLength)
        val rawLineEnd = layout.getLineEnd(line).coerceIn(rawLineStart, textLength)
        var lineStart = max(safeStart, rawLineStart)
        var lineEnd = min(safeEnd, rawLineEnd)

        while (lineStart < lineEnd && text[lineStart].isWhitespace()) {
          lineStart += 1
        }
        while (lineEnd > lineStart && text[lineEnd - 1].isWhitespace()) {
          lineEnd -= 1
        }
        if (lineStart >= lineEnd) continue

        val x = layout.getPrimaryHorizontal(lineStart)
        val baseline = layout.getLineBaseline(line).toFloat()
        canvas.drawText(text, lineStart, lineEnd, x, baseline, textPaint)
      }
    }
  }

  private fun hitTestActiveSelectionHighlight(tapX: Float, tapY: Float): Boolean {
    if (
      activeSelectionRanges.isEmpty() ||
      (activeSelectionKind != ActiveSelectionKind.TEXT && activeSelectionKind != ActiveSelectionKind.WORD)
    ) {
      return false
    }

    if (geometryDirty) {
      rebuildGeometry()
    }

    val currentPage = page ?: return false
    val horizontalPad = dp(1f).toFloat()
    val topPad = dp(12f).toFloat()
    val bottomPad = dp(5f).toFloat()

    activeSelectionRanges.forEach { range ->
      if (range.pageIndex != currentPage.pageIndex || range.spineIndex != currentPage.spineIndex) {
        return@forEach
      }

      val rendered = renderedTextBlocks.firstOrNull { item -> item.block.blockId == range.blockId }
        ?: return@forEach
      val layout = rendered.layout
      val text = blockTextForSelection(rendered.block)
      val textLength = text.length
      if (textLength <= 0 || layout.lineCount <= 0) return@forEach

      val safeStart = (range.sourceStartOffset - rendered.block.sourceStartOffset)
        .coerceIn(0, textLength)
      val safeEnd = (range.sourceEndOffset - rendered.block.sourceStartOffset)
        .coerceIn(safeStart, textLength)
      if (safeStart >= safeEnd) return@forEach

      val localX = tapX - rendered.x
      val localY = tapY - rendered.y
      val startLine = layout.getLineForOffset(safeStart)
      val endLine = layout.getLineForOffset(max(safeStart, safeEnd - 1))

      for (line in startLine..endLine) {
        val rawLineStart = layout.getLineStart(line).coerceIn(0, textLength)
        val rawLineEnd = layout.getLineEnd(line).coerceIn(rawLineStart, textLength)
        var lineStart = max(safeStart, rawLineStart)
        var lineEnd = min(safeEnd, rawLineEnd)

        while (lineStart < lineEnd && text[lineStart].isWhitespace()) {
          lineStart += 1
        }
        while (lineEnd > lineStart && text[lineEnd - 1].isWhitespace()) {
          lineEnd -= 1
        }
        if (lineStart >= lineEnd) continue

        val selectedThroughLineStart = safeStart <= rawLineStart
        val selectedThroughLineEnd = safeEnd >= rawLineEnd
        val startX = if (selectedThroughLineStart) {
          layout.getLineLeft(line)
        } else {
          layout.getPrimaryHorizontal(lineStart)
        }
        val endX = if (selectedThroughLineEnd) {
          layout.getLineRight(line)
        } else {
          layout.getPrimaryHorizontal(lineEnd)
        }
        val left = min(startX, endX) - horizontalPad
        val right = max(startX, endX) + horizontalPad
        val verticalMetrics = selectionHighlightVerticalMetrics(
          layout = layout,
          line = line,
          textPaint = rendered.block.textPaint,
          topPad = topPad,
          bottomPad = bottomPad
        ) ?: continue

        if (localX in left..right && localY in verticalMetrics.top..verticalMetrics.bottom) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Shade one level underline from its gradient weight: 0 = "you very nearly know
   * this" (easy/green), 1 = "well above you" (hard/red), interpolated through the
   * mid stop at 0.5.
   *
   * The stroke thickens slightly with weight as well. That's deliberate: a
   * green→red ramp is the classic red-green colorblindness trap, so weight is
   * carried by a second, non-chromatic channel too. It is a mitigation, not a
   * substitute for a proper accessible mode.
   */
  private fun applyLevelUnderlineShade(paint: Paint, weight: Float?, reinforced: Boolean) {
    val w = (weight ?: 1f).coerceIn(0f, 1f)
    val base = levelColorForWeight(w)
    // §8: a hard-but-frequent word keeps its weight (thickness) but is desaturated
    // toward the calm slate; a hard+rare word stays on the salient green→red gradient.
    paint.color = if (reinforced) lerpColor(base, reinforcedUnderlineTint, 0.6f) else base
    paint.strokeWidth = dp(1.4f + (0.8f * w)).toFloat()
  }

  private fun levelColorForWeight(w: Float): Int = if (w <= 0.5f) {
    lerpColor(levelUnderlineEasyColor, levelUnderlineMidColor, w / 0.5f)
  } else {
    lerpColor(levelUnderlineMidColor, levelUnderlineHardColor, (w - 0.5f) / 0.5f)
  }

  // Component-wise RGB interpolation. Deliberately not going through a perceptual
  // space: the three stops are close enough in luminance that the simple lerp
  // reads smoothly, and this runs per range per draw.
  private fun lerpColor(from: Int, to: Int, t: Float): Int {
    val amount = t.coerceIn(0f, 1f)
    val r = Color.red(from) + ((Color.red(to) - Color.red(from)) * amount)
    val g = Color.green(from) + ((Color.green(to) - Color.green(from)) * amount)
    val b = Color.blue(from) + ((Color.blue(to) - Color.blue(from)) * amount)
    return Color.rgb(r.toInt(), g.toInt(), b.toInt())
  }

  private fun drawLevelUnderline(
    canvas: Canvas,
    layout: StaticLayout,
    localStart: Int,
    localEnd: Int,
    textLength: Int,
    paint: Paint
  ) {
    val safeStart = localStart.coerceIn(0, textLength)
    val safeEnd = localEnd.coerceIn(safeStart, textLength)
    if (safeStart >= safeEnd) return

    val startLine = layout.getLineForOffset(safeStart)
    val endLine = layout.getLineForOffset(max(safeStart, safeEnd - 1))

    for (line in startLine..endLine) {
      val lineStart = max(safeStart, layout.getLineStart(line))
      val lineEnd = min(safeEnd, layout.getLineEnd(line))
      if (lineStart >= lineEnd) continue

      val startX = layout.getPrimaryHorizontal(lineStart)
      val endX = layout.getPrimaryHorizontal(lineEnd)
      val left = min(startX, endX)
      val right = max(startX, endX)
      val underlineY = layout.getLineBaseline(line).toFloat() + dp(3f)
      canvas.drawLine(left, underlineY, right, underlineY, paint)
    }
  }

  private fun wordCenterY(
    rendered: RenderedTextBlock,
    layout: StaticLayout,
    tokenRange: LocalTokenRange,
    fallbackLine: Int
  ): Float {
    highlightPath.reset()
    highlightBounds.setEmpty()
    layout.getSelectionPath(tokenRange.start, tokenRange.end, highlightPath)
    highlightPath.computeBounds(highlightBounds, true)

    return if (highlightBounds.width() > 0f || highlightBounds.height() > 0f) {
      rendered.y + highlightBounds.centerY()
    } else {
      rendered.y + (
        layout.getLineTop(fallbackLine) +
          layout.getLineBottom(fallbackLine)
        ) / 2f
    }
  }

  private fun tokenRangeAtOffset(text: String, offset: Int): LocalTokenRange? {
    if (text.isEmpty()) {
      return null
    }

    var probe = offset.coerceIn(0, text.length)
    if (probe == text.length) {
      probe -= 1
    }

    if (isCjkIdeograph(text[probe])) {
      cjkTokenRangeAtOffset(text, probe)?.let { return it }
    }

    if (!isReaderTokenChar(text[probe])) {
      probe = when {
        probe > 0 && isReaderTokenChar(text[probe - 1]) -> probe - 1
        probe + 1 < text.length && isReaderTokenChar(text[probe + 1]) -> probe + 1
        else -> return null
      }
    }

    var start = probe
    while (start > 0 && isReaderTokenChar(text[start - 1])) {
      start -= 1
    }

    var end = probe + 1
    while (end < text.length && isReaderTokenChar(text[end])) {
      end += 1
    }

    return if (start < end) LocalTokenRange(start, end) else null
  }

  private fun cjkTokenRangeAtOffset(text: String, offset: Int): LocalTokenRange? {
    val probe = offset.coerceIn(0, text.length - 1)
    if (!isCjkIdeograph(text[probe])) {
      return null
    }

    var runStart = probe
    while (runStart > 0 && isCjkIdeograph(text[runStart - 1])) {
      runStart -= 1
    }

    var runEnd = probe + 1
    while (runEnd < text.length && isCjkIdeograph(text[runEnd])) {
      runEnd += 1
    }

    val runText = text.substring(runStart, runEnd)
    val relativeProbe = probe - runStart
    val iterator = BreakIterator.getWordInstance(Locale.CHINESE)
    iterator.setText(runText)

    val segmentStart = iterator.preceding(relativeProbe + 1)
    val segmentEnd = iterator.following(relativeProbe)

    if (
      segmentStart != BreakIterator.DONE &&
      segmentEnd != BreakIterator.DONE &&
      segmentStart < segmentEnd
    ) {
      val candidate = runText.substring(segmentStart, segmentEnd).trim()
      if (candidate.any { isCjkIdeograph(it) }) {
        return LocalTokenRange(runStart + segmentStart, runStart + segmentEnd)
      }
    }

    return LocalTokenRange(probe, probe + 1)
  }

  // Resolve the local [start, end) offsets of the sentence containing the
  // word at [localStart, localEnd) within the block. Prefers the precomputed
  // sentenceRanges (the same source focus mode uses); falls back to scanning
  // for sentence-boundary punctuation. Returns null if nothing sensible is
  // found so the caller can default to the bare word.
  private fun sentenceBoundsAtOffset(
    block: PageBlock,
    localStart: Int,
    localEnd: Int
  ): Pair<Int, Int>? {
    val blockText = blockTextForSelection(block)
    if (blockText.isEmpty()) {
      return null
    }

    val probe = localStart.coerceIn(0, blockText.length)
    val match = block.sentenceRanges.firstOrNull { probe in it.first..(it.last + 1) }
    if (match != null) {
      val start = match.first.coerceIn(0, blockText.length)
      val end = (match.last + 1).coerceIn(start, blockText.length)
      if (start < end) {
        return start to end
      }
    }

    val boundaries = setOf('.', '!', '?', '。', '！', '？', '\n')
    var start = localStart.coerceIn(0, blockText.length)
    while (start > 0 && !boundaries.contains(blockText[start - 1])) {
      start -= 1
    }
    var end = localEnd.coerceIn(start, blockText.length)
    while (end < blockText.length && !boundaries.contains(blockText[end])) {
      end += 1
    }
    if (end < blockText.length && boundaries.contains(blockText[end]) && blockText[end] != '\n') {
      end += 1
    }
    return if (start < end) start to end else null
  }

  private fun sentenceForToken(text: String, tokenRange: LocalTokenRange): String {
    if (text.isEmpty()) {
      return ""
    }

    val sentenceBoundaries = setOf('.', '!', '?', '。', '！', '？', '\n')
    var start = tokenRange.start.coerceIn(0, text.length)
    while (start > 0 && !sentenceBoundaries.contains(text[start - 1])) {
      start -= 1
    }

    var end = tokenRange.end.coerceIn(start, text.length)
    while (end < text.length && !sentenceBoundaries.contains(text[end])) {
      end += 1
    }
    if (end < text.length && sentenceBoundaries.contains(text[end]) && text[end] != '\n') {
      end += 1
    }

    return text.substring(start, end)
      .replace(Regex("\\s+"), " ")
      .trim()
      .trim('“', '”', '"', '\'', '‘', '’')
  }

  private fun describeNoHitArea(tapX: Float, tapY: Float): String {
    val currentPage = page ?: return "outside text"
    val contentWidth = width - (paddingH * 2)
    if (contentWidth <= 0) return "outside text"

    var yOffset = paddingV.toFloat()
    currentPage.blocks.forEach { block ->
      val marginTopStart = yOffset
      yOffset += block.marginTop
      if (tapY in marginTopStart..yOffset) return "margin"

      val blockX = (paddingH + block.marginLeft).toFloat()
      val blockWidth = block.contentWidth.takeIf { it > 0 } ?: contentWidth
      val blockHeight = if (block.type == "image") {
        block.imageHeight
      } else {
        val layout = block.textLayout ?: buildFallbackTextLayout(block, contentWidth)
        layout?.height ?: 0
      }
      val blockBottom = yOffset + blockHeight

      if (tapY in yOffset..blockBottom) {
        if (tapX < blockX || tapX > blockX + blockWidth) return "margin"
        return if (block.type == "image") "image" else "blank space"
      }

      yOffset = blockBottom
      val marginBottomStart = yOffset
      yOffset += block.marginBottom
      if (tapY in marginBottomStart..yOffset) return "margin"
    }

    return "outside text"
  }

  private fun drawSelectionHandles(
    canvas: Canvas,
    block: PageBlock,
    layout: StaticLayout
  ) {
    if (activeSelectionKind != ActiveSelectionKind.TEXT || activeSelectionRanges.isEmpty()) {
      return
    }

    val ranges = sortedActiveTextSelectionRanges()
    val startRange = ranges.firstOrNull()
    val endRange = ranges.lastOrNull()
    val blockTextLength = blockTextForSelection(block).length
    if (blockTextLength <= 0) return

    if (startRange?.blockId == block.blockId) {
      val localStart = (startRange.sourceStartOffset - block.sourceStartOffset)
        .coerceIn(0, blockTextLength)
      drawSelectionHandle(canvas, block, layout, localStart, SelectionHandle.START)
    }

    if (endRange?.blockId == block.blockId) {
      val localEnd = (endRange.sourceEndOffset - block.sourceStartOffset)
        .coerceIn(0, blockTextLength)
      drawSelectionHandle(canvas, block, layout, localEnd, SelectionHandle.END)
    }
  }

  private fun drawSelectionHandle(
    canvas: Canvas,
    block: PageBlock,
    layout: StaticLayout,
    localOffset: Int,
    handle: SelectionHandle
  ) {
    val metrics = selectionHandleLineMetrics(layout, localOffset, handle, block.textPaint) ?: return

    canvas.drawLine(metrics.x, metrics.stemTop, metrics.x, metrics.stemBottom, selectionHandlePaint)
    canvas.drawCircle(metrics.x, metrics.knobCenterY, dp(5f).toFloat(), selectionHandleKnobPaint)
  }

  private fun hitTestSelectionHandle(tapX: Float, tapY: Float): SelectionHandle? {
    if (activeSelectionKind != ActiveSelectionKind.TEXT || activeSelectionRanges.isEmpty()) {
      return null
    }

    if (geometryDirty) {
      rebuildGeometry()
    }

    val hitSlop = dp(24f).toFloat()
    return selectionHandleGeometries()
      .filter { geometry ->
        val top = min(geometry.lineTop, geometry.knobCenterY) - hitSlop
        val bottom = max(geometry.lineBottom, geometry.knobCenterY) + hitSlop
        abs(tapX - geometry.x) <= hitSlop && tapY in top..bottom
      }
      .minByOrNull { geometry ->
        abs(tapX - geometry.x) + abs(tapY - geometry.knobCenterY)
      }
      ?.handle
  }

  private fun selectionHandleGeometries(): List<SelectionHandleGeometry> {
    val endpoints = activeTextSelectionEndpoints() ?: return emptyList()

    return listOfNotNull(
      selectionHandleGeometry(endpoints.first, SelectionHandle.START),
      selectionHandleGeometry(endpoints.second, SelectionHandle.END)
    )
  }

  private fun selectionHandleGeometry(
    position: TextPosition,
    handle: SelectionHandle
  ): SelectionHandleGeometry? {
    val rendered = renderedTextBlocks.getOrNull(position.renderedIndex) ?: return null
    val layout = rendered.layout
    val metrics = selectionHandleLineMetrics(layout, position.localOffset, handle, rendered.block.textPaint)
      ?: return null

    val x = rendered.x + metrics.x
    val lineTop = rendered.y + metrics.stemTop
    val lineBottom = rendered.y + metrics.stemBottom
    val knobCenterY = rendered.y + metrics.knobCenterY

    return SelectionHandleGeometry(
      handle = handle,
      x = x,
      lineTop = lineTop,
      lineBottom = lineBottom,
      knobCenterY = knobCenterY
    )
  }

  private fun selectionHandleLineMetrics(
    layout: StaticLayout,
    localOffset: Int,
    handle: SelectionHandle,
    textPaint: TextPaint?
  ): SelectionHandleLineMetrics? {
    if (layout.lineCount <= 0) return null

    val textLength = layout.text.length
    val safeOffset = localOffset.coerceIn(0, textLength)
    val lineOffset = when (handle) {
      SelectionHandle.START -> safeOffset
      SelectionHandle.END -> max(0, safeOffset - 1)
    }.coerceIn(0, textLength)
    val line = layout.getLineForOffset(lineOffset).coerceIn(0, layout.lineCount - 1)
    val verticalMetrics = selectionHighlightVerticalMetrics(
      layout = layout,
      line = line,
      textPaint = textPaint,
      topPad = dp(12f).toFloat(),
      bottomPad = dp(5f).toFloat()
    ) ?: return null
    val stemTop = verticalMetrics.top
    val stemBottom = verticalMetrics.bottom
    val knobCenterY = when (handle) {
      SelectionHandle.START -> stemTop - dp(2f)
      SelectionHandle.END -> stemBottom + dp(2f)
    }

    return SelectionHandleLineMetrics(
      x = selectionHandleHorizontal(layout, safeOffset, line, handle),
      stemTop = stemTop,
      stemBottom = stemBottom,
      knobCenterY = knobCenterY
    )
  }

  private fun selectionHandleHorizontal(
    layout: StaticLayout,
    safeOffset: Int,
    selectedLine: Int,
    handle: SelectionHandle
  ): Float {
    if (handle == SelectionHandle.END && safeOffset > 0 && safeOffset < layout.text.length) {
      val safeOffsetLine = layout.getLineForOffset(safeOffset).coerceIn(0, layout.lineCount - 1)
      if (safeOffsetLine != selectedLine) {
        return layout.getLineRight(selectedLine)
      }
    }

    return layout.getPrimaryHorizontal(safeOffset)
  }

  private fun selectionHighlightVerticalMetrics(
    layout: StaticLayout,
    line: Int,
    textPaint: TextPaint?,
    topPad: Float,
    bottomPad: Float
  ): SelectionHighlightVerticalMetrics? {
    if (line !in 0 until layout.lineCount) return null

    val lineTop = layout.getLineTop(line).toFloat()
    val lineBottom = layout.getLineBottom(line).toFloat()
    val baseline = layout.getLineBaseline(line).toFloat()
    val fontMetrics = textPaint?.fontMetrics
    val contentTop = fontMetrics?.let { baseline + it.ascent } ?: lineTop
    val contentBottom = fontMetrics?.let { baseline + it.descent } ?: lineBottom
    val top = max(lineTop - dp(6f), contentTop - topPad)
    val bottom = min(lineBottom - dp(1f), contentBottom + bottomPad)

    return if (bottom > top) {
      SelectionHighlightVerticalMetrics(top = top, bottom = bottom)
    } else {
      null
    }
  }

  private fun buildFallbackTextLayout(block: PageBlock, pageContentWidth: Int): StaticLayout? {
    val text = block.styledText ?: return null
    val textPaint = block.textPaint ?: return null
    val blockWidth = block.contentWidth.takeIf { it > 0 } ?: pageContentWidth
    val effectiveLineHeightMult = block.lineHeightMult.takeIf { it > 0f } ?: lineHeightMult

    return StaticLayout.Builder
      .obtain(text, 0, text.length, textPaint, blockWidth)
      .setAlignment(block.textAlign)
      .setLineSpacing(0f, effectiveLineHeightMult)
      .setIncludePad(true)
      .build()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    geometryDirty = true
    if (w > 0 && h > 0) postInvalidateOnAnimation()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (page != null) {
      geometryDirty = true
      postInvalidateOnAnimation()
    }
  }

  override fun onDetachedFromWindow() {
    cancelPendingLongPress()
    activeSelectionHandle = null
    handleDragStartRanges = emptyList()
    if (isSelectionMode) {
      finishDragSelection(cancelled = true)
    }
    super.onDetachedFromWindow()
  }

  private fun drawImage(
    canvas: Canvas,
    block: PageBlock,
    x: Float,
    y: Float,
    contentWidth: Int
  ) {
    val uri = block.imageUri
    val bitmap = if (uri.isNullOrBlank()) null else bitmapForUri(uri)

    if (bitmap == null) {
      canvas.drawRoundRect(
        RectF(x, y, x + contentWidth, y + block.imageHeight),
        8f,
        8f,
        placeholderPaint
      )
      return
    }

    val scale = minOf(
      contentWidth.toFloat() / bitmap.width.toFloat(),
      block.imageHeight.toFloat() / bitmap.height.toFloat()
    )
    val drawWidth = bitmap.width * scale
    val drawHeight = bitmap.height * scale
    val left = x + ((contentWidth - drawWidth) / 2f)
    val top = y + ((block.imageHeight - drawHeight) / 2f)

    canvas.drawBitmap(
      bitmap,
      null,
      RectF(left, top, left + drawWidth, top + drawHeight),
      null
    )
  }

  private fun bitmapForUri(uri: String): Bitmap? {
    if (bitmapCache.containsKey(uri)) {
      return bitmapCache[uri]
    }

    val bitmap = try {
      context.contentResolver.openInputStream(Uri.parse(uri))?.use { stream ->
        BitmapFactory.decodeStream(stream)
      }
    } catch (_: Exception) {
      null
    }

    bitmapCache[uri] = bitmap
    return bitmap
  }

  private fun blockTextForSelection(block: PageBlock): String {
    return block.plainText.ifEmpty { block.styledText?.toString() ?: "" }
  }

  private fun dp(value: Float): Int {
    return (value * resources.displayMetrics.density).toInt()
  }

  private fun sp(value: Float): Float {
    return TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_SP,
      value,
      resources.displayMetrics
    )
  }
}

private fun loadReaderSansTypeface(context: Context, weight: String): Typeface {
  val assetNames = when (weight) {
    "bold" -> listOf(
      "Inter_700Bold.ttf",
      "fonts/Inter_700Bold.ttf",
      "node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf"
    )
    "medium" -> listOf(
      "Inter_600SemiBold.ttf",
      "Inter_500Medium.ttf",
      "fonts/Inter_600SemiBold.ttf",
      "fonts/Inter_500Medium.ttf",
      "node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf",
      "node_modules/@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf"
    )
    else -> listOf(
      "Inter_400Regular.ttf",
      "fonts/Inter_400Regular.ttf",
      "node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf"
    )
  }

  assetNames.forEach { assetName ->
    runCatching {
      return Typeface.createFromAsset(context.assets, assetName)
    }
  }

  return when (weight) {
    "bold" -> Typeface.create("sans-serif", Typeface.BOLD)
    "medium" -> Typeface.create("sans-serif-medium", Typeface.NORMAL)
    else -> Typeface.create("sans-serif", Typeface.NORMAL)
  }
}

private fun loadReaderDisplayTypeface(context: Context, weight: String): Typeface {
  val assetNames = when (weight) {
    "bold" -> listOf(
      "Fraunces_600SemiBold.ttf",
      "Fraunces_700Bold.ttf",
      "fonts/Fraunces_600SemiBold.ttf",
      "fonts/Fraunces_700Bold.ttf",
      "node_modules/@expo-google-fonts/fraunces/600SemiBold/Fraunces_600SemiBold.ttf",
      "node_modules/@expo-google-fonts/fraunces/700Bold/Fraunces_700Bold.ttf"
    )
    else -> listOf(
      "Fraunces_500Medium.ttf",
      "Fraunces_400Regular.ttf",
      "fonts/Fraunces_500Medium.ttf",
      "fonts/Fraunces_400Regular.ttf",
      "node_modules/@expo-google-fonts/fraunces/500Medium/Fraunces_500Medium.ttf",
      "node_modules/@expo-google-fonts/fraunces/400Regular/Fraunces_400Regular.ttf"
    )
  }

  assetNames.forEach { assetName ->
    runCatching {
      return Typeface.createFromAsset(context.assets, assetName)
    }
  }

  return Typeface.create("serif", if (weight == "bold") Typeface.BOLD else Typeface.NORMAL)
}
