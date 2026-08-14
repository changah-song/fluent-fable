package expo.modules.nativeepubreader

import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.StaticLayout
import android.text.TextPaint

// A single renderable block on a page. Text blocks may represent either a
// complete EPUB block or a slice of a block split across a page boundary.
// sentenceRanges: character offset ranges within plainText, first..last inclusive.
data class PageBlock(
  val blockId: String,
  val type: String,
  val tag: String,
  val styledText: SpannableStringBuilder? = null,
  val plainText: String = "",
  val sourceStartOffset: Int = 0,
  val textPaint: TextPaint? = null,
  val textLayout: StaticLayout? = null,
  val textAlign: Layout.Alignment = Layout.Alignment.ALIGN_NORMAL,
  val imageUri: String? = null,
  val imageHeight: Int = 0,
  val contentWidth: Int = 0,
  val marginLeft: Int = 0,
  val marginTop: Int = 0,
  val marginBottom: Int = 0,
  val lineHeightMult: Float = 1.5f,
  val sentenceRanges: List<IntRange> = emptyList()
)

data class ReaderPage(
  val pageIndex: Int,
  val blocks: List<PageBlock>,
  val spineIndex: Int? = null,
  val href: String = "",
  val path: String = "",
  val chapterPageIndex: Int = pageIndex,
  val chapterPageCount: Int = 0,
  val edgeState: ReaderEdgeState? = null
)

enum class ReaderEdgeKind {
  BOOK_FINISHED
}

data class ReaderEdgeState(
  val kind: ReaderEdgeKind,
  val chapterTitle: String,
  val bookTitle: String,
  val chapterCount: Int,
  val savedWordCount: Int
)

data class TextRange(
  val pageIndex: Int,
  val spineIndex: Int?,
  val blockId: String,
  val sourceStartOffset: Int,
  val sourceEndOffset: Int,
  // Level-underline shading position in [0, 1] (0 = nearly known, 1 = well above
  // the reader). Null for every other range kind — selections and saved
  // highlights take their color from the palette, not from a gradient.
  val levelWeight: Float? = null,
  // Pinyin for this word, drawn above it when the reader's pinyin toggle is on
  // (Chinese only). Null for every non-level range and when no reading is known.
  val pinyin: String? = null,
  // §8: this word is hard but frequent enough that the book will reteach it, so it is
  // shaded with a calmer tone than a hard+rare ("study") word. Level ranges only.
  val levelReinforced: Boolean = false
)

// A focused sentence span in focus (sentence beam) mode. Offsets are local to
// the block's plain text.
data class FocusRange(
  val blockId: String,
  val startOffset: Int,
  val endOffset: Int
)

data class WordHit(
  val text: String,
  val placement: String,
  val range: TextRange,
  val localStartOffset: Int,
  val localEndOffset: Int,
  val sentence: String = ""
)

data class TextSelectionHit(
  val text: String,
  val placement: String,
  val ranges: List<TextRange>
)

enum class ActiveSelectionKind {
  WORD,
  TEXT
}

internal fun isCjkIdeograph(char: Char): Boolean {
  val code = char.code

  return when {
    code in 0x4E00..0x9FFF -> true // CJK Unified Ideographs
    code in 0x3400..0x4DBF -> true // CJK Unified Ideographs Extension A
    code in 0xF900..0xFAFF -> true // CJK Compatibility Ideographs
    else -> false
  }
}

internal fun isReaderTokenChar(char: Char): Boolean {
  val code = char.code

  return when {
    code in 0xAC00..0xD7A3 -> true // Hangul syllables
    code in 0x1100..0x11FF -> true // Hangul Jamo
    code in 0x3130..0x318F -> true // Hangul Compatibility Jamo
    isCjkIdeograph(char) -> true
    char in 'A'..'Z' || char in 'a'..'z' -> true
    char.isDigit() -> true
    else -> false
  }
}
