package expo.modules.screenocroverlay

import android.graphics.Rect
import com.google.mlkit.vision.text.Text
import kotlin.math.abs
import kotlin.math.roundToInt

data class OcrTapTarget(
  val text: String,
  val lineText: String,
  val box: Rect,
  val kind: String
) {
  fun selectionAtImageX(imageX: Float): OcrTapSelection {
    val selectedText = if (kind == "line") {
      selectLineTokenAtImageX(lineText, box, imageX)
    } else {
      text.trimLookupToken().ifEmpty { lineText.trimLookupToken() }
    }

    return OcrTapSelection(
      selectedText = selectedText,
      lineText = lineText,
      box = Rect(box),
      kind = kind
    )
  }
}

data class OcrTapSelection(
  val selectedText: String,
  val lineText: String,
  val box: Rect,
  val kind: String
)

data class OverlayCaptureBounds(
  val left: Int,
  val top: Int,
  val width: Int,
  val height: Int
) {
  fun toMap(): Map<String, Int> =
    mapOf(
      "left" to left,
      "top" to top,
      "width" to width,
      "height" to height
    )

  fun toLogString(): String = "$left,$top ${width}x$height"
}

data class OcrDebugBox(
  val text: String,
  val box: Rect,
  val kind: String,
  val accepted: Boolean
)

data class SerializedOcrResult(
  val result: Map<String, Any?>,
  val targets: List<OcrTapTarget>,
  val debugBoxes: List<OcrDebugBox>
)

data class OverlayLookupResult(
  val requestId: String,
  val surface: String,
  val stem: String,
  val definition: String?,
  val translation: String?,
  val translationSourceLanguage: String?,
  val translationTargetLanguage: String?,
  val explanation: String?,
  val explanationGloss: String?,
  val hanja: String?,
  val pos: String?,
  val romanization: String?,
  val saved: Boolean,
  val sourceSentence: String,
  val alternatives: List<OverlayDefinitionEntry>,
  val hanjaPreloads: List<OverlayHanjaPreload>,
  val wordOptions: List<String>
)

data class OverlayDefinitionEntry(
  val word: String,
  val definition: String?,
  val hanja: String?,
  val pos: String?,
  val romanization: String?,
  val saved: Boolean
)

data class OverlaySaveResult(
  val requestId: String,
  val saved: Boolean,
  val alternativeIndex: Int?
)

data class OverlayHanjaResult(
  val requestId: String,
  val character: String,
  val meaning: String?,
  val sound: String?,
  val relatedWords: List<OverlayHanjaRelatedWord>
)

data class OverlayHanjaPreload(
  val sourceWord: String,
  val character: String,
  val meaning: String?,
  val sound: String?,
  val relatedWords: List<OverlayHanjaRelatedWord>
)

data class OverlayHanjaRelatedWord(
  val korean: String,
  val hanja: String,
  val meaning: String,
  val known: Boolean
)

object OcrSerializer {
  private const val TOP_CHROME_RATIO = 0.14f
  // A line is kept only if enough of it is in the target language's script, which
  // drops UI chrome and stray Latin. The script depends on the target language
  // (Hangul for Korean, Han ideographs for Chinese), so this must be language-aware.
  private const val MIN_TARGET_SCRIPT_RATIO = 0.25f
  private val ignoredLabels = setOf("ocr", "floating ocr")

  fun serialize(
    result: Text,
    imageWidth: Int,
    imageHeight: Int,
    language: String? = null,
    filterTopChrome: Boolean = true,
    includeText: Boolean = true,
    includeBlocks: Boolean = true,
    includeDebugBoxes: Boolean = true
  ): SerializedOcrResult {
    val targets = mutableListOf<OcrTapTarget>()
    val debugBoxes = mutableListOf<OcrDebugBox>()
    val blocks = if (includeBlocks) mutableListOf<Map<String, Any?>>() else null
    result.textBlocks.forEach { block ->
      serializeBlock(
        block = block,
        imageHeight = imageHeight,
        language = language,
        filterTopChrome = filterTopChrome,
        targets = targets,
        debugBoxes = debugBoxes,
        includeBlocks = includeBlocks,
        includeDebugBoxes = includeDebugBoxes
      )?.let { serializedBlock ->
        blocks?.add(serializedBlock)
      }
    }
    val resultPayload = mutableMapOf<String, Any?>(
      "imageWidth" to imageWidth,
      "imageHeight" to imageHeight,
      "targets" to targets.map(::serializeTapTarget)
    )
    if (includeText) {
      resultPayload["text"] = result.text
    }
    if (includeBlocks) {
      resultPayload["blocks"] = blocks ?: emptyList<Map<String, Any?>>()
    }

    return SerializedOcrResult(
      result = resultPayload,
      targets = targets,
      debugBoxes = debugBoxes
    )
  }

  fun withTargets(
    serialized: SerializedOcrResult,
    targets: List<OcrTapTarget>
  ): SerializedOcrResult =
    serialized.copy(
      result = serialized.result + mapOf("targets" to targets.map(::serializeTapTarget)),
      targets = targets
    )

  private fun serializeBlock(
    block: Text.TextBlock,
    imageHeight: Int,
    language: String?,
    filterTopChrome: Boolean,
    targets: MutableList<OcrTapTarget>,
    debugBoxes: MutableList<OcrDebugBox>,
    includeBlocks: Boolean,
    includeDebugBoxes: Boolean
  ): Map<String, Any?>? {
    val lines = if (includeBlocks) mutableListOf<Map<String, Any?>>() else null
    block.lines.forEach { line ->
      serializeLine(
        line = line,
        imageHeight = imageHeight,
        language = language,
        filterTopChrome = filterTopChrome,
        targets = targets,
        debugBoxes = debugBoxes,
        includeBlocks = includeBlocks,
        includeDebugBoxes = includeDebugBoxes
      )?.let { serializedLine ->
        lines?.add(serializedLine)
      }
    }

    return if (includeBlocks) mapOf(
      "text" to block.text,
      "box" to serializeBox(block.boundingBox),
      "lines" to lines.orEmpty()
    ) else null
  }

  private fun serializeLine(
    line: Text.Line,
    imageHeight: Int,
    language: String?,
    filterTopChrome: Boolean,
    targets: MutableList<OcrTapTarget>,
    debugBoxes: MutableList<OcrDebugBox>,
    includeBlocks: Boolean,
    includeDebugBoxes: Boolean
  ): Map<String, Any?>? {
    val lineBox = line.boundingBox
    val lineText = line.text.trim()
    val accepted = shouldAcceptLine(lineText, lineBox, imageHeight, filterTopChrome, language)

    if (includeDebugBoxes && lineBox != null && lineText.isNotEmpty()) {
      debugBoxes.add(
        OcrDebugBox(
          text = lineText,
          box = Rect(lineBox),
          kind = "line",
          accepted = accepted
        )
      )
    }

    val serializedElements = if (includeBlocks) {
      line.elements.map { element ->
        serializeElement(element, debugBoxes, includeDebugBoxes)
      }
    } else {
      emptyList()
    }

    if (accepted && lineBox != null) {
      targets.add(
        OcrTapTarget(
          text = lineText,
          lineText = lineText,
          box = Rect(lineBox),
          kind = "line"
        )
      )

      val wordTargets = createElementWordTargets(lineText, lineBox, line.elements)
        .ifEmpty { createSyntheticWordTargets(lineText, lineBox) }
      if (includeDebugBoxes) {
        wordTargets.forEach { target ->
          debugBoxes.add(
            OcrDebugBox(
              text = target.text,
              box = Rect(target.box),
              kind = target.kind,
              accepted = true
            )
          )
        }
      }
      targets.addAll(wordTargets)
    }

    return if (includeBlocks) mapOf(
      "text" to line.text,
      "box" to serializeBox(line.boundingBox),
      "elements" to serializedElements
    ) else null
  }

  private fun serializeElement(
    element: Text.Element,
    debugBoxes: MutableList<OcrDebugBox>,
    includeDebugBoxes: Boolean
  ): Map<String, Any?> {
    val elementText = element.text.trim()
    val elementBox = element.boundingBox

    if (includeDebugBoxes && elementText.isNotEmpty() && elementBox != null) {
      debugBoxes.add(
        OcrDebugBox(
          text = elementText,
          box = Rect(elementBox),
          kind = "element",
          accepted = false
        )
      )
    }

    return mapOf(
      "text" to element.text,
      "box" to serializeBox(element.boundingBox)
    )
  }

  fun serializeBox(rect: Rect?): Map<String, Int>? {
    if (rect == null) {
      return null
    }

    return mapOf(
      "x" to rect.left,
      "y" to rect.top,
      "width" to rect.width(),
      "height" to rect.height()
    )
  }

  fun serializeDebugBox(debugBox: OcrDebugBox): Map<String, Any?> =
    mapOf(
      "text" to debugBox.text,
      "kind" to debugBox.kind,
      "accepted" to debugBox.accepted,
      "box" to serializeBox(debugBox.box)
    )

  private fun serializeTapTarget(target: OcrTapTarget): Map<String, Any?> =
    mapOf(
      "text" to target.text,
      "lineText" to target.lineText,
      "kind" to target.kind,
      "box" to serializeBox(target.box)
    )

  private fun shouldAcceptLine(
    text: String,
    box: Rect?,
    imageHeight: Int,
    filterTopChrome: Boolean,
    language: String?
  ): Boolean {
    if (text.isBlank() || box == null || box.width() <= 0 || box.height() <= 0) {
      return false
    }
    if (filterTopChrome && imageHeight > 0 && box.top < imageHeight * TOP_CHROME_RATIO) {
      return false
    }

    val normalizedText = text.trim().lowercase()
    if (ignoredLabels.contains(normalizedText)) {
      return false
    }

    return targetScriptRatio(text, language) >= MIN_TARGET_SCRIPT_RATIO
  }

  // Share of letters/digits that belong to the target language's script: Han
  // ideographs for Chinese, Hangul for Korean (and the default). Chinese text has
  // no Hangul, so keying this off Hangul dropped every Chinese line.
  private fun targetScriptRatio(text: String, language: String?): Float {
    val contentChars = text.filter { it.isLetterOrDigit() }
    if (contentChars.isEmpty()) {
      return 0f
    }

    val inTargetScript: (Char) -> Boolean = when (OcrRecognizers.normalizeLanguage(language)) {
      "zh" -> ::isCjkIdeograph
      else -> ::isHangul
    }
    return contentChars.count(inTargetScript).toFloat() / contentChars.length
  }

  private fun isHangul(char: Char): Boolean =
    char in '\uAC00'..'\uD7A3' ||
      char in '\u1100'..'\u11FF' ||
      char in '\u3130'..'\u318F'

  private fun isCjkIdeograph(char: Char): Boolean =
    char in '\u3400'..'\u4DBF' ||
      char in '\u4E00'..'\u9FFF' ||
      char in '\uF900'..'\uFAFF'
}

private data class LineToken(
  val text: String,
  val start: Int,
  val end: Int
)

private data class WordPart(
  val text: String,
  val box: Rect
)

private data class WordGroup(
  val text: String,
  val box: Rect
)

private fun createElementWordTargets(
  lineText: String,
  lineBox: Rect,
  elements: List<Text.Element>
): List<OcrTapTarget> {
  if (elements.isEmpty()) {
    return emptyList()
  }

  val parts = elements
    .flatMap { element -> createElementWordParts(element, lineBox) }
    .sortedWith(compareBy<WordPart> { it.box.left }.thenBy { it.box.centerY() })

  if (parts.isEmpty()) {
    return emptyList()
  }

  val tokenTargets = createLineTokenTargetsFromElementParts(lineText, lineBox, parts)
  if (tokenTargets.isNotEmpty()) {
    return tokenTargets
  }

  val groups = createGeometryWordGroups(parts, lineBox)
  if (groups.isEmpty()) {
    return emptyList()
  }

  val reconstructedLineText = if (groups.size > 1) {
    groups.joinToString(separator = " ") { it.text }
  } else {
    lineText
  }

  return groups.map { group ->
    OcrTapTarget(
      text = group.text,
      lineText = reconstructedLineText,
      box = Rect(group.box),
      kind = "word"
    )
  }
}

private fun createElementWordParts(element: Text.Element, lineBox: Rect): List<WordPart> {
  val elementBox = element.boundingBox ?: return emptyList()
  val rawText = element.text.trim()

  if (rawText.isEmpty() || elementBox.width() <= 0 || elementBox.height() <= 0) {
    return emptyList()
  }
  if (!isBoxNearLine(elementBox, lineBox)) {
    return emptyList()
  }

  val matches = Regex("\\S+").findAll(rawText).toList()
  if (matches.size <= 1) {
    val elementText = rawText.trimLookupToken()
    return if (elementText.isEmpty()) {
      emptyList()
    } else {
      listOf(WordPart(text = elementText, box = Rect(elementBox)))
    }
  }

  val measurableLength = rawText.length.coerceAtLeast(1)
  return matches.mapNotNull { match ->
    val text = match.value.trimLookupToken()
    if (text.isEmpty()) {
      return@mapNotNull null
    }

    val left = elementBox.left + (elementBox.width() * (match.range.first.toFloat() / measurableLength)).roundToInt()
    val right = elementBox.left + (elementBox.width() * ((match.range.last + 1).toFloat() / measurableLength)).roundToInt()
    WordPart(
      text = text,
      box = Rect(
        left.coerceIn(elementBox.left, elementBox.right - 1),
        elementBox.top,
        right.coerceIn(left + 1, elementBox.right),
        elementBox.bottom
      )
    )
  }
}

private fun createLineTokenTargetsFromElementParts(
  lineText: String,
  lineBox: Rect,
  parts: List<WordPart>
): List<OcrTapTarget> {
  val tokens = splitLookupTokensWithOffsets(lineText)
  if (tokens.size <= 1) {
    return emptyList()
  }
  if (parts.size == 1) {
    return createSyntheticWordTargets(lineText, lineBox)
  }

  val lineContent = lookupContent(lineText)
  val partsContent = lookupContent(parts.joinToString(separator = "") { it.text })
  if (!textsLikelyMatch(partsContent, lineContent)) {
    return emptyList()
  }

  val groups = mutableListOf<WordGroup>()
  var partIndex = 0
  tokens.forEachIndexed { tokenIndex, token ->
    val targetLength = lookupContentLength(token.text).coerceAtLeast(1)
    val startPartIndex = partIndex
    var consumedLength = 0

    while (
      partIndex < parts.size &&
      (consumedLength < targetLength || startPartIndex == partIndex || tokenIndex == tokens.lastIndex)
    ) {
      consumedLength += lookupContentLength(parts[partIndex].text).coerceAtLeast(1)
      partIndex += 1
    }

    if (startPartIndex < partIndex) {
      val groupParts = parts.subList(startPartIndex, partIndex)
      groups.add(
        WordGroup(
          text = token.text,
          box = mergePartBoxes(groupParts)
        )
      )
    }
  }

  if (groups.size != tokens.size) {
    return emptyList()
  }

  return groups.map { group ->
    OcrTapTarget(
      text = group.text,
      lineText = lineText,
      box = Rect(group.box),
      kind = "word"
    )
  }
}

private fun createGeometryWordGroups(parts: List<WordPart>, lineBox: Rect): List<WordGroup> {
  if (parts.isEmpty()) {
    return emptyList()
  }
  if (parts.size == 1) {
    return listOf(WordGroup(text = parts.first().text, box = Rect(parts.first().box)))
  }
  if (parts.all { lookupContentLength(it.text) > 1 }) {
    return parts.map { part ->
      WordGroup(text = part.text, box = Rect(part.box))
    }
  }

  val gapThreshold = wordGapThreshold(parts, lineBox)
  val groupedParts = mutableListOf<MutableList<WordPart>>()
  var currentGroup = mutableListOf(parts.first())

  parts.drop(1).forEach { part ->
    val previous = currentGroup.last()
    val gap = part.box.left - previous.box.right
    if (gap >= gapThreshold) {
      groupedParts.add(currentGroup)
      currentGroup = mutableListOf(part)
    } else {
      currentGroup.add(part)
    }
  }
  groupedParts.add(currentGroup)

  return groupedParts.mapNotNull { groupParts ->
    val text = groupParts.joinToString(separator = "") { it.text }.trimLookupToken()
    if (text.isEmpty()) {
      return@mapNotNull null
    }

    WordGroup(
      text = text,
      box = mergePartBoxes(groupParts)
    )
  }
}

private fun wordGapThreshold(parts: List<WordPart>, lineBox: Rect): Float {
  val totalChars = parts.sumOf { lookupContentLength(it.text).coerceAtLeast(1) }.coerceAtLeast(1)
  val averageCharWidth = parts.sumOf { it.box.width() }.toFloat() / totalChars
  val baseThreshold = maxOf(3f, minOf(lineBox.height() * 0.22f, averageCharWidth * 0.45f))
  val positiveGaps = parts.zipWithNext()
    .map { (previous, next) -> (next.box.left - previous.box.right).toFloat() }
    .filter { it > 0f }
    .sorted()

  if (positiveGaps.size >= 3) {
    val medianGap = positiveGaps[positiveGaps.size / 2]
    val largestGap = positiveGaps.last()
    if (largestGap > medianGap * 2f + 2f) {
      return maxOf(3f, minOf(baseThreshold, medianGap * 1.6f + 1.5f))
    }
  }

  return baseThreshold
}

private fun isBoxNearLine(box: Rect, lineBox: Rect): Boolean {
  val xPadding = maxOf(4, lineBox.height() / 2)
  val yPadding = maxOf(4, lineBox.height() / 2)
  val centerX = box.centerX()
  val centerY = box.centerY()

  return centerX >= lineBox.left - xPadding &&
    centerX <= lineBox.right + xPadding &&
    centerY >= lineBox.top - yPadding &&
    centerY <= lineBox.bottom + yPadding
}

private fun mergePartBoxes(parts: List<WordPart>): Rect =
  Rect(
    parts.minOf { it.box.left },
    parts.minOf { it.box.top },
    parts.maxOf { it.box.right },
    parts.maxOf { it.box.bottom }
  )

private fun lookupContent(text: String): String =
  text.filter(Char::isLetterOrDigit)

private fun lookupContentLength(text: String): Int =
  lookupContent(text).length

private fun textsLikelyMatch(first: String, second: String): Boolean {
  if (first.isEmpty() || second.isEmpty()) {
    return false
  }
  if (first == second || first.contains(second) || second.contains(first)) {
    return true
  }

  val shorterLength = minOf(first.length, second.length)
  if (shorterLength == 0 || abs(first.length - second.length) > 2) {
    return false
  }

  val matchingCharacters = first.zip(second).count { (left, right) -> left == right }
  return matchingCharacters.toFloat() / shorterLength >= 0.72f
}

private fun createSyntheticWordTargets(lineText: String, lineBox: Rect): List<OcrTapTarget> {
  val tokens = splitLookupTokensWithOffsets(lineText)
  if (tokens.isEmpty() || lineBox.width() <= 0) {
    return emptyList()
  }
  if (tokens.size == 1) {
    return listOf(
      OcrTapTarget(
        text = tokens.first().text,
        lineText = lineText,
        box = Rect(lineBox),
        kind = "word"
      )
    )
  }

  val measurableLength = lineText.length.coerceAtLeast(1)

  return tokens.map { token ->
    val tokenLeft = lineBox.left + (lineBox.width() * (token.start.toFloat() / measurableLength)).roundToInt()
    val tokenRight = lineBox.left + (lineBox.width() * (token.end.toFloat() / measurableLength)).roundToInt()
    val targetBox = Rect(
      tokenLeft.coerceIn(lineBox.left, lineBox.right),
      lineBox.top,
      tokenRight.coerceIn(lineBox.left, lineBox.right),
      lineBox.bottom
    )

    OcrTapTarget(
      text = token.text,
      lineText = lineText,
      box = targetBox,
      kind = "word"
    )
  }.filter { it.box.width() > 0 }
}

private fun selectLineTokenAtImageX(lineText: String, lineBox: Rect, imageX: Float): String {
  val tokens = splitLookupTokensWithOffsets(lineText)
  if (tokens.isEmpty()) {
    return lineText.trimLookupToken()
  }
  if (tokens.size == 1 || lineBox.width() <= 0) {
    return tokens.first().text
  }

  val relativeX = ((imageX - lineBox.left) / lineBox.width()).coerceIn(0f, 0.999f)
  val estimatedOffset = (relativeX * lineText.length).roundToInt().coerceIn(0, lineText.length)
  val containingToken = tokens.firstOrNull { token ->
    estimatedOffset in token.start..token.end
  }

  if (containingToken != null) {
    return containingToken.text
  }

  return tokens.minByOrNull { token ->
    when {
      estimatedOffset < token.start -> token.start - estimatedOffset
      estimatedOffset > token.end -> estimatedOffset - token.end
      else -> 0
    }
  }?.text ?: tokens.first().text
}

private fun splitLookupTokensWithOffsets(text: String): List<LineToken> {
  val tokens = mutableListOf<LineToken>()
  var tokenStart: Int? = null

  text.forEachIndexed { index, char ->
    if (char.isWhitespace()) {
      tokenStart?.let { start ->
        addLookupToken(text, start, index, tokens)
        tokenStart = null
      }
    } else if (tokenStart == null) {
      tokenStart = index
    }
  }

  tokenStart?.let { start ->
    addLookupToken(text, start, text.length, tokens)
  }

  return tokens
}

private fun addLookupToken(
  source: String,
  start: Int,
  end: Int,
  tokens: MutableList<LineToken>
) {
  val raw = source.substring(start, end)
  val trimmed = raw.trimLookupToken()
  if (trimmed.isEmpty()) {
    return
  }

  tokens.add(
    LineToken(
      text = trimmed,
      start = start,
      end = end
    )
  )
}

private fun String.trimLookupToken(): String =
  trim { char -> char.isWhitespace() || !char.isLetterOrDigit() }
