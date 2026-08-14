package expo.modules.nativeepubreader

import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView

class EpubPageAdapter(
  private var pages: List<ReaderPage>,
  private val paddingH: Int,
  private val paddingV: Int,
  private var lineHeightMult: Float,
  private var backgroundColor: Int,
  private var themePalette: ReaderThemePalette,
  private var activeSelectionRanges: List<TextRange>,
  private var activeSelectionKind: ActiveSelectionKind?,
  private var savedHighlightRangesByPage: Map<Int, List<TextRange>>,
  private var levelRangesByPage: Map<Int, List<TextRange>>,
  private var showPinyin: Boolean,
  private var activeHighlightColor: Int,
  private var textSelectionHighlightColor: Int,
  private var savedHighlightColor: Int,
  private var savedHighlightTextColor: Int,
  private var levelUnderlineEasyColor: Int,
  private var levelUnderlineMidColor: Int,
  private var levelUnderlineHardColor: Int,
  private val onWordSelected: (WordHit) -> Unit,
  private val onTextSelected: (TextSelectionHit) -> Unit,
  private val onSelectionCleared: () -> Unit,
  private val onSelectionDragStateChanged: (Boolean) -> Unit,
  private val onEdgeAction: (ReaderEdgeKind) -> Unit
) : RecyclerView.Adapter<EpubPageAdapter.PageHolder>() {

  class PageHolder(val view: EpubPageView) : RecyclerView.ViewHolder(view)

  override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PageHolder {
    val view = EpubPageView(parent.context).apply {
      layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    }
    return PageHolder(view)
  }

  override fun onBindViewHolder(holder: PageHolder, position: Int) {
    bindView(holder.view, position)
  }

  override fun getItemCount(): Int = pages.size

  fun updatePages(newPages: List<ReaderPage>) {
    pages = newPages
    notifyDataSetChanged()
  }

  fun updateRenderConfig(lineHeightMult: Float, backgroundColor: Int) {
    this.lineHeightMult = lineHeightMult
    this.backgroundColor = backgroundColor
    notifyDataSetChanged()
  }

  fun updateThemePalette(nextPalette: ReaderThemePalette) {
    themePalette = nextPalette
  }

  fun updateActiveSelectionRanges(
    selectionRanges: List<TextRange>,
    selectionKind: ActiveSelectionKind?
  ) {
    activeSelectionRanges = selectionRanges
    activeSelectionKind = selectionKind
  }

  fun updateSavedHighlightRanges(rangesByPage: Map<Int, List<TextRange>>) {
    savedHighlightRangesByPage = rangesByPage
  }

  fun setShowPinyin(enabled: Boolean) {
    if (showPinyin == enabled) {
      return
    }
    showPinyin = enabled
    notifyDataSetChanged()
  }

  fun updateLevelUnderlineRanges(rangesByPage: Map<Int, List<TextRange>>) {
    levelRangesByPage = rangesByPage
  }

  fun updateHighlightColors(
    activeColor: Int,
    textSelectionColor: Int,
    savedColor: Int,
    savedTextColor: Int,
    levelEasyColor: Int,
    levelMidColor: Int,
    levelHardColor: Int
  ) {
    activeHighlightColor = activeColor
    textSelectionHighlightColor = textSelectionColor
    savedHighlightColor = savedColor
    savedHighlightTextColor = savedTextColor
    levelUnderlineEasyColor = levelEasyColor
    levelUnderlineMidColor = levelMidColor
    levelUnderlineHardColor = levelHardColor
  }

  fun invalidateVisiblePages(recyclerView: RecyclerView?, fallbackPosition: Int = -1) {
    if (recyclerView == null) {
      return
    }

    for (index in 0 until recyclerView.childCount) {
      val child = recyclerView.getChildAt(index)
      val holder = recyclerView.getChildViewHolder(child) as? PageHolder ?: continue
      val position = holderPosition(holder, fallbackPosition)

      if (position in pages.indices) {
        val page = pages[position]
        holder.view.updateHighlights(
          activeSelectionRanges = activeSelectionRanges,
          activeSelectionKind = activeSelectionKind,
          savedHighlightRanges = savedHighlightRangesByPage[page.pageIndex].orEmpty(),
          levelRanges = levelRangesByPage[page.pageIndex].orEmpty(),
          activeHighlightColor = activeHighlightColor,
          textSelectionHighlightColor = textSelectionHighlightColor,
          savedHighlightColor = savedHighlightColor,
          savedHighlightTextColor = savedHighlightTextColor,
          levelUnderlineEasyColor = levelUnderlineEasyColor,
          levelUnderlineMidColor = levelUnderlineMidColor,
          levelUnderlineHardColor = levelUnderlineHardColor
        )
      }
    }
  }

  fun rebindVisiblePages(recyclerView: RecyclerView?, fallbackPosition: Int = -1) {
    if (recyclerView == null) {
      return
    }

    for (index in 0 until recyclerView.childCount) {
      val child = recyclerView.getChildAt(index)
      val holder = recyclerView.getChildViewHolder(child) as? PageHolder ?: continue
      val position = holderPosition(holder, fallbackPosition)

      if (position in pages.indices) {
        bindView(holder.view, position)
      }
    }
  }

  private fun bindView(view: EpubPageView, position: Int) {
    val page = pages[position]
    view.bind(
      page = page,
      paddingH = paddingH,
      paddingV = paddingV,
      lineHeightMult = lineHeightMult,
      backgroundColor = backgroundColor,
      themePalette = themePalette,
      activeSelectionRanges = activeSelectionRanges,
      activeSelectionKind = activeSelectionKind,
      savedHighlightRanges = savedHighlightRangesByPage[page.pageIndex].orEmpty(),
      levelRanges = levelRangesByPage[page.pageIndex].orEmpty(),
      activeHighlightColor = activeHighlightColor,
      textSelectionHighlightColor = textSelectionHighlightColor,
      savedHighlightColor = savedHighlightColor,
      savedHighlightTextColor = savedHighlightTextColor,
      levelUnderlineEasyColor = levelUnderlineEasyColor,
      levelUnderlineMidColor = levelUnderlineMidColor,
      levelUnderlineHardColor = levelUnderlineHardColor,
      onWordSelected = onWordSelected,
      onTextSelected = onTextSelected,
      onSelectionCleared = onSelectionCleared,
      onSelectionDragStateChanged = onSelectionDragStateChanged,
      onEdgeAction = onEdgeAction,
      showPinyin = showPinyin
    )
  }

  private fun holderPosition(holder: PageHolder, fallbackPosition: Int): Int {
    return when {
      holder.bindingAdapterPosition != RecyclerView.NO_POSITION -> holder.bindingAdapterPosition
      fallbackPosition in pages.indices -> fallbackPosition
      else -> RecyclerView.NO_POSITION
    }
  }
}
