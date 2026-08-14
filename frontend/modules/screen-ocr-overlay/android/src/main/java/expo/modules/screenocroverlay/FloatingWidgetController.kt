package expo.modules.screenocroverlay

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.text.TextPaint
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import kotlin.math.abs
import kotlin.math.max

class FloatingWidgetController(
  private val context: Context,
  private val onBubbleTap: () -> Unit,
  private val onCancelRequested: () -> Unit,
  private val onStopRequested: () -> Unit,
  private val onTargetSelected: (OcrTapSelection) -> Unit,
  private val onWordNavigationRequested: (OcrTapSelection) -> Unit,
  private val onTranslationRequested: (String, String) -> Unit,
  private val onExplainRequested: (String, String, String) -> Unit,
  private val onExplainSaveRequested: (String) -> Unit,
  private val onSaveRequested: (String, Int?) -> Unit,
  private val onHanjaRequested: (String, String) -> String?,
  private val onRelatedKnownToggleRequested: (String, String, OverlayHanjaRelatedWord) -> Unit,
  private val onResultOverlayClosed: () -> Unit
) {
  private val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  private val mainHandler = Handler(Looper.getMainLooper())
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private val density = context.resources.displayMetrics.density
  private var bubbleView: View? = null
  private var bubbleParams: WindowManager.LayoutParams? = null
  private var dismissTargetView: DismissTargetView? = null
  private var dismissTargetActive = false
  private var resultOverlayView: OcrResultOverlayView? = null
  private var resultOverlayParams: WindowManager.LayoutParams? = null
  private var lastBubbleX: Int? = null
  private var lastBubbleY: Int? = null
  private var lastBubbleRect: RectF? = null
  private var restoreBubbleAfterHiddenCapture = false
  private var bubbleRunning = false

  val isBubbleVisible: Boolean
    get() = bubbleView != null

  val isResultOverlayVisible: Boolean
    get() = resultOverlayView != null

  fun showBubble(): Boolean {
    if (bubbleView != null) {
      return true
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      throw IllegalStateException(OverlayText.t("floatingOcrRequiresAndroid8"))
    }
    if (!Settings.canDrawOverlays(context)) {
      throw IllegalStateException(OverlayText.t("overlayPermissionNotGranted"))
    }

    val visualSize = dp(56f).toInt()
    val viewSize = dp(72f).toInt()
    val visualInset = (viewSize - visualSize) / 2
    val view = OcrBubbleView(context, density).apply {
      contentDescription = OverlayText.t("floatingOcrActive")
      setRunning(bubbleRunning)
    }
    val displayMetrics = context.resources.displayMetrics
    val params = WindowManager.LayoutParams(
      viewSize,
      viewSize,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = lastBubbleX ?: max(dp(12f).toInt(), displayMetrics.widthPixels - visualSize - dp(24f).toInt() - visualInset)
      y = lastBubbleY ?: max(dp(84f).toInt(), displayMetrics.heightPixels - visualSize - dp(48f).toInt() - visualInset)
    }

    attachDragHandler(view, params)
    windowManager.addView(view, params)
    bubbleView = view
    bubbleParams = params

    return true
  }

  fun hideBubble() {
    hideDismissTarget()

    val params = bubbleParams
    val view = bubbleView
    if (params != null && view != null) {
      lastBubbleRect = bubbleRect(params, view)
    }

    params?.let {
      lastBubbleX = params.x
      lastBubbleY = params.y
    }

    bubbleView?.let { floatingView ->
      try {
        windowManager.removeView(floatingView)
      } catch (_: Exception) {
      }
    }

    bubbleView = null
    bubbleParams = null
  }

  fun setBubbleRunning(running: Boolean) {
    bubbleRunning = running
    (bubbleView as? OcrBubbleView)?.setRunning(running)
  }

  fun bringBubbleToFront() {
    bubbleView?.bringToFront()
  }

  fun showResultOverlayShell(): Boolean = showOrUpdateResultOverlay(null)

  fun showResultOverlay(result: SerializedOcrResult): Boolean = showOrUpdateResultOverlay(result)

  fun getResultOverlayBoundsOnScreen(): OverlayCaptureBounds? {
    val view = resultOverlayView ?: return null
    if (view.width <= 0 || view.height <= 0) {
      return null
    }

    val location = IntArray(2)
    view.getLocationOnScreen(location)

    return OverlayCaptureBounds(
      left = location[0],
      top = location[1],
      width = view.width,
      height = view.height
    )
  }

  fun waitForResultOverlayBounds(timeoutMs: Long, onBounds: (OverlayCaptureBounds?) -> Unit) {
    val startedAt = SystemClock.uptimeMillis()
    val poller = object : Runnable {
      override fun run() {
        val bounds = getResultOverlayBoundsOnScreen()
        if (bounds != null) {
          onBounds(bounds)
          return
        }

        if (SystemClock.uptimeMillis() - startedAt >= timeoutMs) {
          onBounds(null)
          return
        }

        mainHandler.postDelayed(this, 16L)
      }
    }

    mainHandler.post(poller)
  }

  private fun showOrUpdateResultOverlay(result: SerializedOcrResult?): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      throw IllegalStateException(OverlayText.t("floatingOcrRequiresAndroid8"))
    }
    if (!Settings.canDrawOverlays(context)) {
      throw IllegalStateException(OverlayText.t("overlayPermissionNotGranted"))
    }

    resultOverlayView?.let { view ->
      view.setCloseAnchorRect(lastBubbleRect)
      if (result == null) {
        setResultOverlayTouchable(false)
        view.clearResult()
      } else {
        setResultOverlayTouchable(true)
        view.setResult(result)
      }
      return true
    }

    val overlayView = OcrResultOverlayView(
      context = context,
      ocrResult = result,
      onTargetSelected = onTargetSelected,
      onWordNavigationRequested = onWordNavigationRequested,
      onTranslationRequested = onTranslationRequested,
      onExplainRequested = onExplainRequested,
      onExplainSaveRequested = onExplainSaveRequested,
      onSaveRequested = onSaveRequested,
      onHanjaRequested = onHanjaRequested,
      onRelatedKnownToggleRequested = onRelatedKnownToggleRequested,
      closeAnchorRectOnScreen = lastBubbleRect?.let { RectF(it) },
      onClose = {
        hideResultOverlay()
        try {
          restoreBubbleIfNeeded()
        } catch (_: Exception) {
        }
        onResultOverlayClosed()
      }
    )
    val baseFlags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
      WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
      WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      baseFlags or if (result == null) WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE else 0,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
    }

    windowManager.addView(overlayView, params)
    resultOverlayView = overlayView
    resultOverlayParams = params

    return true
  }

  fun showLookupLoading(requestId: String, selection: OcrTapSelection) {
    resultOverlayView?.showLookupLoading(requestId, selection)
  }

  fun showLookupResult(result: OverlayLookupResult) {
    resultOverlayView?.showLookupResult(result)
  }

  fun showLookupError(requestId: String, message: String, fallback: Boolean) {
    resultOverlayView?.showLookupError(requestId, message, fallback)
  }

  fun hasLookupCard(requestId: String): Boolean =
    resultOverlayView?.hasLookupCard(requestId) == true

  fun showSaving(requestId: String, alternativeIndex: Int?) {
    resultOverlayView?.showSaving(requestId, alternativeIndex)
  }

  fun showSaveResult(result: OverlaySaveResult) {
    resultOverlayView?.showSaveResult(result)
  }

  fun showSaveError(requestId: String, message: String) {
    resultOverlayView?.showSaveError(requestId, message)
  }

  fun showHanjaLoading(requestId: String, character: String, sourceWord: String) {
    resultOverlayView?.showHanjaLoading(requestId, character, sourceWord)
  }

  fun showHanjaResult(result: OverlayHanjaResult) {
    resultOverlayView?.showHanjaResult(result)
  }

  fun hasHanjaPopup(requestId: String): Boolean =
    resultOverlayView?.hasHanjaPopup(requestId) == true

  fun showHanjaError(requestId: String, message: String) {
    resultOverlayView?.showHanjaError(requestId, message)
  }

  fun hideResultOverlay() {
    resultOverlayView?.let { view ->
      try {
        windowManager.removeView(view)
      } catch (_: Exception) {
      }
    }

    resultOverlayView = null
    resultOverlayParams = null
  }

  private fun setResultOverlayTouchable(touchable: Boolean) {
    val view = resultOverlayView ?: return
    val params = resultOverlayParams ?: return
    val nextFlags = if (touchable) {
      params.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
    } else {
      params.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
    }
    if (params.flags == nextFlags) {
      return
    }

    params.flags = nextFlags
    try {
      windowManager.updateViewLayout(view, params)
    } catch (_: Exception) {
    }
  }

  fun hideOverlaysForCapture(): Boolean {
    val shouldRestoreBubble = hideBubbleForCapture()
    hideResultOverlay()
    return shouldRestoreBubble
  }

  fun hideBubbleForCapture(): Boolean {
    val shouldRestoreBubble = isBubbleVisible || restoreBubbleAfterHiddenCapture
    restoreBubbleAfterHiddenCapture = shouldRestoreBubble
    hideBubble()
    return shouldRestoreBubble
  }

  fun restoreBubbleIfNeeded() {
    if (!restoreBubbleAfterHiddenCapture) {
      return
    }

    restoreBubbleAfterHiddenCapture = false
    showBubble()
  }

  fun removeAll() {
    restoreBubbleAfterHiddenCapture = false
    setBubbleRunning(false)
    hideResultOverlay()
    hideBubble()
  }

  fun handleInterfaceLanguageChanged() {
    (bubbleView as? OcrBubbleView)?.refreshContentDescription()
    dismissTargetView?.refreshContentDescription()
    dismissTargetView?.invalidate()
    resultOverlayView?.invalidate()
  }

  fun handleTargetLanguageChanged() {
    (bubbleView as? OcrBubbleView)?.invalidate()
  }

  private fun attachDragHandler(view: View, params: WindowManager.LayoutParams) {
    val bubble = view as? OcrBubbleView
    var downRawX = 0f
    var downRawY = 0f
    var startX = 0
    var startY = 0
    var isDragging = false
    var didLongPress = false

    val longPressRunnable = Runnable {
      didLongPress = true
      onStopRequested()
    }

    view.setOnTouchListener { _, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          isDragging = false
          didLongPress = false
          downRawX = event.rawX
          downRawY = event.rawY
          startX = params.x
          startY = params.y
          bubble?.setBubbleState(dragging = false, overClose = false)
          mainHandler.postDelayed(longPressRunnable, ViewConfiguration.getLongPressTimeout().toLong())
          true
        }

        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - downRawX
          val dy = event.rawY - downRawY

          if (abs(dx) > touchSlop || abs(dy) > touchSlop) {
            mainHandler.removeCallbacks(longPressRunnable)
            isDragging = true
          }

          params.x = startX + dx.toInt()
          params.y = startY + dy.toInt()
          lastBubbleX = params.x
          lastBubbleY = params.y

          try {
            windowManager.updateViewLayout(view, params)
          } catch (_: Exception) {
          }

          if (isDragging) {
            val overClose = isBubbleInsideDismissTarget(params, view)
            bubble?.setBubbleState(dragging = true, overClose = overClose)
            showDismissTarget(overClose)
          }
          true
        }

        MotionEvent.ACTION_UP -> {
          mainHandler.removeCallbacks(longPressRunnable)
          val moved = abs(event.rawX - downRawX) > touchSlop || abs(event.rawY - downRawY) > touchSlop
          val shouldDismiss = isDragging && isBubbleInsideDismissTarget(params, view)
          bubble?.setBubbleState(dragging = false, overClose = false)
          hideDismissTarget()

          if (shouldDismiss) {
            onStopRequested()
          } else if (!moved && !didLongPress) {
            if (bubbleRunning) {
              onCancelRequested()
            } else {
              onBubbleTap()
            }
          }
          true
        }

        MotionEvent.ACTION_CANCEL -> {
          mainHandler.removeCallbacks(longPressRunnable)
          bubble?.setBubbleState(dragging = false, overClose = false)
          hideDismissTarget()
          true
        }

        else -> false
      }
    }
  }

  private fun showDismissTarget(active: Boolean) {
    val targetWidth = dismissTargetWindowWidth()
    val targetHeight = dismissTargetWindowHeight()
    val view = dismissTargetView ?: DismissTargetView(context, density).apply {
      refreshContentDescription()
      alpha = 0f
      translationY = dp(18f)
    }.also { newView ->
      val params = WindowManager.LayoutParams(
        targetWidth,
        targetHeight,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
          WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
          WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT
      ).apply {
        gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
        y = dp(24f).toInt()
      }

      windowManager.addView(newView, params)
      dismissTargetView = newView
      newView.animate()
        .alpha(1f)
        .translationY(0f)
        .setDuration(200L)
        .start()
    }

    updateDismissTarget(view, active)
  }

  private fun updateDismissTarget(view: DismissTargetView, active: Boolean) {
    if (dismissTargetActive == active) {
      return
    }
    dismissTargetActive = active
    view.setDismissActive(active)
  }

  private fun hideDismissTarget() {
    dismissTargetView?.let { view ->
      try {
        windowManager.removeView(view)
      } catch (_: Exception) {
      }
    }

    dismissTargetView = null
    dismissTargetActive = false
  }

  private fun isBubbleInsideDismissTarget(params: WindowManager.LayoutParams, view: View): Boolean {
    val bubbleRect = bubbleRect(params, view)
    val targetRect = dismissTargetRect()

    return RectF.intersects(bubbleRect, targetRect)
  }

  private fun bubbleRect(params: WindowManager.LayoutParams, view: View): RectF {
    if (view is OcrBubbleView) {
      return view.visualRectOnScreen(params.x.toFloat(), params.y.toFloat())
    }

    val bubbleWidth = view.width.takeIf { it > 0 } ?: params.width
    val bubbleHeight = view.height.takeIf { it > 0 } ?: params.height

    return RectF(
      params.x.toFloat(),
      params.y.toFloat(),
      params.x + bubbleWidth.toFloat(),
      params.y + bubbleHeight.toFloat()
    )
  }

  private fun dismissTargetRect(): RectF {
    val metrics = context.resources.displayMetrics
    val targetWidth = dismissTargetVisualWidth(dismissTargetActive)
    val targetHeight = dismissTargetVisualHeight(dismissTargetActive)
    val left = (metrics.widthPixels - targetWidth) / 2f
    val bottom = metrics.heightPixels - dp(32f)
    val top = bottom - targetHeight

    return RectF(left, top, left + targetWidth, bottom)
  }

  private fun dismissTargetVisualWidth(active: Boolean = dismissTargetActive): Float =
    dp(if (active) 200f else 160f)

  private fun dismissTargetVisualHeight(active: Boolean = dismissTargetActive): Float =
    dp(if (active) 56f else 48f)

  private fun dismissTargetWindowWidth(): Int = dp(216f).toInt()

  private fun dismissTargetWindowHeight(): Int = dp(72f).toInt()

  private fun dp(value: Float): Float = value * density
}

private class OcrBubbleView(
  context: Context,
  private val density: Float
) : View(context) {
  private val circlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(230, 32, 38, 49)
    style = Paint.Style.FILL
  }
  private val glyphPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(250, 248, 245)
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
    style = Paint.Style.STROKE
  }
  // Draws the target-language badge (한 / 中) so the floating bubble shows, at a
  // glance, which script the next scan will recognize.
  private val labelPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(250, 248, 245)
    typeface = Typeface.DEFAULT_BOLD
    textAlign = Paint.Align.CENTER
  }
  private val glyphPath = Path()
  private var running = false
  private var dragging = false
  private var overClose = false

  init {
    setWillNotDraw(false)
    setBackgroundColor(Color.TRANSPARENT)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      isForceDarkAllowed = false
    }
  }

  fun setBubbleState(dragging: Boolean, overClose: Boolean) {
    if (this.dragging == dragging && this.overClose == overClose) {
      return
    }
    this.dragging = dragging
    this.overClose = overClose
    invalidate()
  }

  fun setRunning(nextRunning: Boolean) {
    if (running == nextRunning) {
      return
    }

    running = nextRunning
    refreshContentDescription()
    invalidate()
  }

  fun refreshContentDescription() {
    contentDescription = if (running) {
      OverlayText.t("cancelFloatingOcrScan")
    } else {
      OverlayText.t("floatingOcrActive")
    }
  }

  fun visualRectOnScreen(screenLeft: Float, screenTop: Float): RectF {
    val diameter = bubbleDiameter()
    val measuredWidth = width.takeIf { it > 0 }?.toFloat() ?: dp(72f)
    val measuredHeight = height.takeIf { it > 0 }?.toFloat() ?: dp(72f)
    val left = screenLeft + measuredWidth / 2f - diameter / 2f
    val top = screenTop + measuredHeight / 2f - diameter / 2f
    return RectF(left, top, left + diameter, top + diameter)
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)

    val centerX = width / 2f
    val centerY = height / 2f
    val scale = if (dragging || overClose) 1.08f else 1f
    val diameter = bubbleDiameter()
    val radius = diameter / 2f - dp(0.5f)

    circlePaint.color = Color.argb(230, 32, 38, 49)
    canvas.drawCircle(centerX, centerY, radius, circlePaint)
    glyphPaint.color = Color.rgb(250, 248, 245)
    if (running) {
      drawXIcon(canvas, centerX, centerY, dp(22f) * scale)
    } else {
      val character = languageBadgeCharacter()
      if (character != null) {
        drawLanguageBadge(canvas, centerX, centerY, character, dp(30f) * scale)
      } else {
        drawGlyph(canvas, centerX, centerY, dp(34f) * scale)
      }
    }
  }

  // The character stands in for the active OCR script: Chinese vs Korean. Falls back
  // to null (the brand glyph) only for languages we don't badge.
  private fun languageBadgeCharacter(): String? =
    when (OcrRecognizers.normalizeLanguage(ScreenOcrOverlayService.getTargetLanguage())) {
      "zh" -> "中"
      "ko" -> "한"
      else -> null
    }

  private fun drawLanguageBadge(canvas: Canvas, centerX: Float, centerY: Float, character: String, size: Float) {
    labelPaint.color = glyphPaint.color
    labelPaint.textSize = size
    val metrics = labelPaint.fontMetrics
    val baseline = centerY - (metrics.ascent + metrics.descent) / 2f
    canvas.drawText(character, centerX, baseline, labelPaint)
  }

  private fun bubbleDiameter(): Float =
    dp(56f) * if (dragging || overClose) 1.08f else 1f

  private fun drawGlyph(canvas: Canvas, centerX: Float, centerY: Float, size: Float) {
    val scale = size / 1024f
    glyphPaint.strokeWidth = 64f
    canvas.save()
    canvas.translate(centerX - size / 2f, centerY - size / 2f)
    canvas.scale(scale, scale)

    glyphPath.reset()
    glyphPath.moveTo(252f, 296f)
    glyphPath.cubicTo(348f, 258f, 462f, 272f, 532f, 330f)
    canvas.drawPath(glyphPath, glyphPaint)

    glyphPath.reset()
    glyphPath.moveTo(532f, 330f)
    glyphPath.cubicTo(602f, 272f, 716f, 258f, 812f, 296f)
    canvas.drawPath(glyphPath, glyphPaint)

    drawGlyphLine(canvas, 252f, 296f, 252f, 700f)
    drawGlyphLine(canvas, 812f, 296f, 812f, 700f)
    drawGlyphLine(canvas, 532f, 330f, 532f, 734f)

    glyphPath.reset()
    glyphPath.moveTo(252f, 700f)
    glyphPath.cubicTo(348f, 662f, 462f, 676f, 532f, 734f)
    canvas.drawPath(glyphPath, glyphPaint)

    glyphPath.reset()
    glyphPath.moveTo(532f, 734f)
    glyphPath.cubicTo(602f, 676f, 716f, 662f, 812f, 700f)
    canvas.drawPath(glyphPath, glyphPaint)

    drawGlyphLine(canvas, 252f, 452f, 396f, 452f)
    drawGlyphLine(canvas, 532f, 462f, 676f, 462f)
    canvas.restore()
  }

  private fun drawXIcon(canvas: Canvas, centerX: Float, centerY: Float, size: Float) {
    val half = size / 2f
    val strokeScale = size / dp(22f)
    glyphPaint.strokeWidth = dp(2.5f) * strokeScale
    canvas.drawLine(centerX - half, centerY - half, centerX + half, centerY + half, glyphPaint)
    canvas.drawLine(centerX + half, centerY - half, centerX - half, centerY + half, glyphPaint)
  }

  private fun drawGlyphLine(canvas: Canvas, startX: Float, startY: Float, endX: Float, endY: Float) {
    canvas.drawLine(startX, startY, endX, endY, glyphPaint)
  }

  private fun dp(value: Float): Float = value * density
}

private class DismissTargetView(
  context: Context,
  private val density: Float
) : View(context) {
  private val pillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.FILL
  }
  private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = dp(1f)
  }
  private val labelPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(154, 156, 159)
    textAlign = Paint.Align.CENTER
    textSize = dp(11f)
    typeface = Typeface.create("sans-serif", Typeface.BOLD)
    letterSpacing = 0.145f
  }

  private var active = false

  init {
    setWillNotDraw(false)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      isForceDarkAllowed = false
    }
  }

  fun setDismissActive(nextActive: Boolean) {
    if (active == nextActive) {
      return
    }

    active = nextActive
    invalidate()
  }

  fun refreshContentDescription() {
    contentDescription = OverlayText.t("dismissFloatingOcr")
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)

    val scaledWidth = dp(if (active) 200f else 160f)
    val scaledHeight = dp(if (active) 56f else 48f)
    val bottom = height - dp(8f)
    val rect = RectF(
      width / 2f - scaledWidth / 2f,
      bottom - scaledHeight,
      width / 2f + scaledWidth / 2f,
      bottom
    )
    val radius = scaledHeight / 2f

    pillPaint.color = if (active) Color.argb(235, 192, 57, 43) else Color.argb(209, 27, 28, 28)
    borderPaint.color = if (active) Color.rgb(224, 90, 74) else Color.rgb(53, 60, 71)
    labelPaint.color = if (active) Color.WHITE else Color.rgb(154, 156, 159)

    canvas.drawRoundRect(rect, radius, radius, pillPaint)
    canvas.drawRoundRect(rect, radius, radius, borderPaint)
    val label = "× ${OverlayText.t("close").uppercase()}"
    canvas.drawText(label, width / 2f, rect.centerY() - (labelPaint.ascent() + labelPaint.descent()) / 2f, labelPaint)
  }

  private fun dp(value: Float): Float = value * density
}
