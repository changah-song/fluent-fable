package expo.modules.screenocroverlay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import expo.modules.kotlin.Promise
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

private const val CAPTURE_HIDE_DELAY_MS = 180L
private const val OVERLAY_LOOKUP_TIMEOUT_MS = 9000L
private const val OVERLAY_SAVE_TIMEOUT_MS = 3500L
private const val OVERLAY_HANJA_TIMEOUT_MS = 9000L

class ScreenOcrOverlayService : Service() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "ScreenOcrOverlayAnalyzer").apply {
      isDaemon = true
    }
  }
  private var captureSession: ScreenCaptureSession? = null
  private var widgetController: FloatingWidgetController? = null
  private var isForeground = false
  @Volatile
  private var isAnalyzing = false
  @Volatile
  private var analysisRunId = 0
  private var pendingLookupRequestId: String? = null
  private var pendingSelectedTarget: OcrTapSelection? = null
  private var currentLookupResult: OverlayLookupResult? = null
  private var pendingLookupTimeoutRunnable: Runnable? = null
  private var pendingSaveRequestId: String? = null
  private var pendingSaveAlternativeIndex: Int? = null
  private var pendingSaveTimeoutRunnable: Runnable? = null
  private var pendingHanjaRequestId: String? = null
  private var pendingHanjaTimeoutRunnable: Runnable? = null

  override fun onCreate() {
    super.onCreate()
    activeInstance = this
    widgetController = FloatingWidgetController(
      context = this,
      onBubbleTap = ::analyzeCurrentScreenForOverlay,
      onCancelRequested = ::cancelCurrentAnalysisFromBubble,
      onStopRequested = {
        stopFloatingWidget()
      },
      onTargetSelected = ::handleTargetSelected,
      onWordNavigationRequested = ::handleTargetSelected,
      onTranslationRequested = ::handleTranslationRequested,
      onExplainRequested = ::handleExplainRequested,
      onExplainSaveRequested = ::handleExplainSaveRequested,
      onSaveRequested = ::handleSaveRequested,
      onHanjaRequested = ::handleHanjaRequested,
      onRelatedKnownToggleRequested = ::handleRelatedKnownToggleRequested,
      onResultOverlayClosed = {
        clearLookupState()
        emitStatus("result_overlay_closed")
      }
    )
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START_CAPTURE -> handleStartCapture(intent)
      ACTION_START_WIDGET -> showFloatingWidget()
      ACTION_STOP_WIDGET -> stopFloatingWidget()
      ACTION_ANALYZE_CURRENT_SCREEN -> analyzeCurrentScreenForOverlay()
    }

    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    cancelAnalysisRuns()
    clearLookupState()
    widgetController?.removeAll()
    widgetController = null
    captureSession?.release()
    captureSession = null
    executor.shutdownNow()

    if (activeInstance === this) {
      activeInstance = null
    }

    super.onDestroy()
  }

  fun isScreenCaptureActive(): Boolean = captureSession != null

  fun isAnalysisActive(): Boolean = isAnalyzing

  fun isFloatingWidgetVisible(): Boolean = widgetController?.isBubbleVisible == true

  fun isResultOverlayVisible(): Boolean = widgetController?.isResultOverlayVisible == true

  fun handleInterfaceLanguageChanged() {
    mainHandler.post {
      widgetController?.handleInterfaceLanguageChanged()
      if (isForeground) {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(NOTIFICATION_ID, buildNotification())
      }
    }
  }

  fun handleTargetLanguageChanged() {
    mainHandler.post {
      widgetController?.handleTargetLanguageChanged()
    }
  }

  fun showFloatingWidget(): Boolean {
    return try {
      if (!Settings.canDrawOverlays(this)) {
        throw IllegalStateException(OverlayText.t("overlayPermissionNotGranted"))
      }
      if (captureSession == null) {
        throw IllegalStateException(OverlayText.t("screenCaptureInactive"))
      }

      val visible = widgetController?.showBubble() == true
      emitStatus("floating_widget_visible")
      visible
    } catch (error: Exception) {
      emitError("start_floating_widget_failed", error)
      false
    }
  }

  fun stopFloatingWidget(): Boolean {
    cancelAnalysisRuns()
    clearLookupState()
    widgetController?.removeAll()
    stopScreenCapture()
    emitStatus("floating_widget_hidden")
    return false
  }

  private fun stopScreenCapture() {
    captureSession?.release()
    captureSession = null

    if (isForeground) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } else {
        @Suppress("DEPRECATION")
        stopForeground(true)
      }
      isForeground = false
    }

    stopSelf()
  }

  fun analyzeCurrentScreenForPromise(promise: Promise) {
    if (captureSession == null) {
      promise.reject("E_SCREEN_CAPTURE_INACTIVE", OverlayText.t("screenCaptureInactive"), null)
      return
    }
    if (isAnalyzing) {
      promise.reject("E_ANALYZE_IN_PROGRESS", OverlayText.t("analyzeInProgress"), null)
      return
    }

    runHiddenCapture(showOverlay = false, promise = promise)
  }

  private fun analyzeCurrentScreenForOverlay() {
    if (captureSession == null) {
      emitError("screen_capture_inactive", IllegalStateException(OverlayText.t("screenCaptureInactive")))
      return
    }
    if (isAnalyzing) {
      emitError("analyze_in_progress", IllegalStateException(OverlayText.t("analyzeInProgress")))
      return
    }

    widgetController?.setBubbleRunning(true)
    emitStatus("ocr_started")
    runHiddenCapture(showOverlay = true, promise = null)
  }

  private fun runHiddenCapture(showOverlay: Boolean, promise: Promise?) {
    val runId = beginAnalysisRun()

    if (showOverlay) {
      val controller = widgetController
      if (controller == null) {
        finishAnalysisRun(runId)
        val error = IllegalStateException(OverlayText.t("floatingControllerUnavailable"))
        emitError("floating_controller_unavailable", error)
        promise?.reject("E_FLOATING_CONTROLLER_UNAVAILABLE", error.message, error)
        return
      }

      try {
        controller.hideOverlaysForCapture()
        emitStatus("capture_overlays_hidden")
      } catch (error: Exception) {
        finishAnalysisRun(runId)
        controller.setBubbleRunning(false)
        restoreBubbleSafely()
        emitError("hide_capture_overlays_failed", error)
        promise?.reject("E_HIDE_CAPTURE_OVERLAYS_FAILED", error.message, error)
        return
      }

      mainHandler.postDelayed({
        startAnalysisWithBounds(showOverlay, promise, null, runId)
      }, CAPTURE_HIDE_DELAY_MS)
      return
    }

    widgetController?.hideOverlaysForCapture()
    emitStatus("capture_overlays_hidden")

    mainHandler.postDelayed({
      startAnalysisWithBounds(showOverlay, promise, null, runId)
    }, CAPTURE_HIDE_DELAY_MS)
  }

  private fun startAnalysisWithBounds(
    showOverlay: Boolean,
    promise: Promise?,
    cropBounds: OverlayCaptureBounds?,
    runId: Int
  ) {
    if (!isCurrentAnalysisRun(runId)) {
      promise?.reject("E_ANALYZE_CANCELLED", OverlayText.t("analysisCancelled"), null)
      return
    }

    val session = captureSession
    if (session == null) {
      finishAnalysisRun(runId)
      mainHandler.post {
        if (!isCurrentAnalysisRun(runId)) {
          return@post
        }

        if (showOverlay) {
          widgetController?.setBubbleRunning(false)
          widgetController?.hideResultOverlay()
        }
        restoreBubbleSafely()
      }
      val error = IllegalStateException(OverlayText.t("screenCaptureInactive"))
      emitError("screen_capture_inactive", error)
      promise?.reject("E_SCREEN_CAPTURE_INACTIVE", error.message, error)
      return
    }

    executor.execute {
      analyzeWithSession(session, showOverlay, promise, cropBounds, runId)
    }
  }

  private fun analyzeWithSession(
    session: ScreenCaptureSession,
    showOverlay: Boolean,
    promise: Promise?,
    cropBounds: OverlayCaptureBounds?,
    runId: Int
  ) {
    try {
      val serialized = session.analyzeLatestImage(cropBounds)

      if (!isCurrentAnalysisRun(runId)) {
        promise?.reject("E_ANALYZE_CANCELLED", OverlayText.t("analysisCancelled"), null)
        return
      }

      ScreenOcrOverlayModule.emitOcrResult(serialized.result)

      if (showOverlay) {
        mainHandler.post {
          if (!isCurrentAnalysisRun(runId)) {
            return@post
          }

          finishAnalysisRun(runId)
          try {
            widgetController?.setBubbleRunning(false)
            widgetController?.hideBubble()
            widgetController?.showResultOverlay(serialized)
            emitStatus("ocr_overlay_visible")
          } catch (error: Exception) {
            widgetController?.hideResultOverlay()
            widgetController?.setBubbleRunning(false)
            restoreBubbleSafely()
            emitError("show_ocr_overlay_failed", error)
          }
        }
      } else {
        finishAnalysisRun(runId)
        mainHandler.post {
          if (!isCurrentAnalysisRun(runId)) {
            return@post
          }

          restoreBubbleSafely()
          emitStatus("ocr_completed")
        }
        promise?.resolve(serialized.result)
      }
    } catch (error: Exception) {
      val isCurrentRun = isCurrentAnalysisRun(runId)
      finishAnalysisRun(runId)
      mainHandler.post {
        if (!isCurrentAnalysisRun(runId)) {
          return@post
        }

        if (showOverlay) {
          widgetController?.setBubbleRunning(false)
          widgetController?.hideResultOverlay()
        }
        restoreBubbleSafely()
      }
      if (isCurrentRun) {
        emitError("analyze_current_screen_failed", error)
      }
      promise?.reject("E_ANALYZE_CURRENT_SCREEN_FAILED", error.message, error)
    }
  }

  private fun beginAnalysisRun(): Int =
    synchronized(this) {
      analysisRunId += 1
      isAnalyzing = true
      analysisRunId
    }

  private fun cancelAnalysisRuns() {
    synchronized(this) {
      analysisRunId += 1
      isAnalyzing = false
    }
  }

  private fun cancelCurrentAnalysisFromBubble() {
    if (!isAnalyzing) {
      widgetController?.setBubbleRunning(false)
      return
    }

    cancelAnalysisRuns()
    clearLookupState()
    widgetController?.hideResultOverlay()
    widgetController?.setBubbleRunning(false)
    restoreBubbleSafely()
    emitStatus("ocr_cancelled")
  }

  private fun finishAnalysisRun(runId: Int) {
    synchronized(this) {
      if (analysisRunId == runId) {
        isAnalyzing = false
      }
    }
  }

  private fun isCurrentAnalysisRun(runId: Int): Boolean =
    synchronized(this) {
      analysisRunId == runId
    }

  private fun clearLookupState() {
    clearPendingLookupTimeout()
    clearPendingSaveTimeout()
    clearPendingHanjaTimeout()
    pendingLookupRequestId = null
    pendingSelectedTarget = null
    currentLookupResult = null
    pendingSaveRequestId = null
    pendingSaveAlternativeIndex = null
    pendingHanjaRequestId = null
  }

  private fun clearPendingLookupTimeout() {
    pendingLookupTimeoutRunnable?.let(mainHandler::removeCallbacks)
    pendingLookupTimeoutRunnable = null
  }

  private fun clearPendingSaveTimeout() {
    pendingSaveTimeoutRunnable?.let(mainHandler::removeCallbacks)
    pendingSaveTimeoutRunnable = null
  }

  private fun clearPendingHanjaTimeout() {
    pendingHanjaTimeoutRunnable?.let(mainHandler::removeCallbacks)
    pendingHanjaTimeoutRunnable = null
  }

  private fun parseLookupResult(
    requestId: String,
    result: Map<String, Any?>,
    currentResult: OverlayLookupResult? = null
  ): OverlayLookupResult? {
    val selectedTarget = pendingSelectedTarget
    val surface = stringValue(result["surface"]).ifBlank {
      currentResult?.surface ?: selectedTarget?.selectedText.orEmpty()
    }
    if (surface.isBlank()) {
      return null
    }

    val stem = stringValue(result["stem"]).ifBlank { currentResult?.stem ?: surface }
    val alternatives = if (result.containsKey("alternatives")) {
      parseDefinitionEntries(result["alternatives"])
    } else {
      currentResult?.alternatives ?: emptyList()
    }
    val hanjaPreloads = if (result.containsKey("hanjaPreloads")) {
      parseHanjaPreloads(result["hanjaPreloads"])
    } else {
      currentResult?.hanjaPreloads ?: emptyList()
    }
    val wordOptions = if (result.containsKey("wordOptions")) {
      parseStringList(result["wordOptions"])
    } else {
      currentResult?.wordOptions ?: emptyList()
    }

    return OverlayLookupResult(
      requestId = requestId,
      surface = surface,
      stem = stem,
      definition = nullableStringValue(result["definition"]) ?: currentResult?.definition,
      translation = nullableStringValue(result["translation"]) ?: currentResult?.translation,
      translationSourceLanguage = nullableStringValue(result["translationSourceLanguage"])
        ?: currentResult?.translationSourceLanguage,
      translationTargetLanguage = nullableStringValue(result["translationTargetLanguage"])
        ?: currentResult?.translationTargetLanguage,
      explanation = nullableStringValue(result["explanation"]) ?: currentResult?.explanation,
      explanationGloss = nullableStringValue(result["explanationGloss"]) ?: currentResult?.explanationGloss,
      hanja = nullableStringValue(result["hanja"]) ?: currentResult?.hanja,
      pos = nullableStringValue(result["pos"]) ?: currentResult?.pos,
      romanization = nullableStringValue(result["romanization"]) ?: currentResult?.romanization,
      saved = boolValue(result["saved"]) ?: currentResult?.saved ?: false,
      sourceSentence = stringValue(result["sourceSentence"]).ifBlank {
        currentResult?.sourceSentence ?: selectedTarget?.lineText.orEmpty()
      },
      alternatives = alternatives,
      hanjaPreloads = hanjaPreloads,
      wordOptions = wordOptions
    )
  }

  private fun parseDefinitionEntries(value: Any?): List<OverlayDefinitionEntry> {
    val entries = value as? List<*> ?: return emptyList()
    return entries.mapNotNull { item ->
      val map = item as? Map<*, *> ?: return@mapNotNull null
      val word = stringValue(map["word"])
      val definition = nullableStringValue(map["definition"])
      if (word.isBlank() && definition.isNullOrBlank()) {
        return@mapNotNull null
      }

      OverlayDefinitionEntry(
        word = word.ifBlank { stringValue(map["stem"]) },
        definition = definition,
        hanja = nullableStringValue(map["hanja"]),
        pos = nullableStringValue(map["pos"]),
        romanization = nullableStringValue(map["romanization"]),
        saved = boolValue(map["saved"]) ?: false
      )
    }
  }

  private fun parseStringList(value: Any?): List<String> {
    val seen = linkedSetOf<String>()
    when (value) {
      is List<*> -> value.forEach { item ->
        stringValue(item).takeIf(String::isNotBlank)?.let(seen::add)
      }
      is Array<*> -> value.forEach { item ->
        stringValue(item).takeIf(String::isNotBlank)?.let(seen::add)
      }
      is String -> value
        .split(Regex("\\s+"))
        .forEach { item ->
          item.trim().takeIf(String::isNotBlank)?.let(seen::add)
        }
      null -> Unit
      else -> stringValue(value).takeIf(String::isNotBlank)?.let(seen::add)
    }

    return seen.toList()
  }

  private fun parseHanjaResult(requestId: String, result: Map<String, Any?>): OverlayHanjaResult? {
    val character = stringValue(result["character"])
    if (character.isBlank()) {
      return null
    }

    return OverlayHanjaResult(
      requestId = requestId,
      character = character,
      meaning = nullableStringValue(result["meaning"]),
      sound = nullableStringValue(result["sound"]),
      relatedWords = parseHanjaRelatedWords(result["relatedWords"])
    )
  }

  private fun parseHanjaPreloads(value: Any?): List<OverlayHanjaPreload> {
    val rows = value as? List<*> ?: return emptyList()
    return rows.mapNotNull { item ->
      val map = item as? Map<*, *> ?: return@mapNotNull null
      val character = stringValue(map["character"])
      if (character.isBlank()) {
        return@mapNotNull null
      }

      OverlayHanjaPreload(
        sourceWord = stringValue(map["sourceWord"]),
        character = character,
        meaning = nullableStringValue(map["meaning"]),
        sound = nullableStringValue(map["sound"]),
        relatedWords = parseHanjaRelatedWords(map["relatedWords"])
      )
    }
  }

  private fun parseHanjaRelatedWords(value: Any?): List<OverlayHanjaRelatedWord> {
    val rows = value as? List<*> ?: return emptyList()
    return rows.mapNotNull { item ->
      val map = item as? Map<*, *> ?: return@mapNotNull null
      val korean = stringValue(map["korean"])
      val hanja = stringValue(map["hanja"])
      val meaning = stringValue(map["meaning"])
      if (korean.isBlank() && hanja.isBlank() && meaning.isBlank()) {
        return@mapNotNull null
      }

      OverlayHanjaRelatedWord(
        korean = korean,
        hanja = hanja,
        meaning = meaning,
        known = boolValue(map["known"]) ?: false
      )
    }
  }

  private fun stringValue(value: Any?): String =
    when (value) {
      is String -> value.trim()
      null -> ""
      else -> value.toString().trim()
    }

  private fun nullableStringValue(value: Any?): String? =
    stringValue(value).takeIf { it.isNotBlank() && it != "N/A" && it != "Unknown" }

  private fun boolValue(value: Any?): Boolean? =
    when (value) {
      is Boolean -> value
      is Number -> value.toInt() != 0
      is String -> value.equals("true", ignoreCase = true) || value == "1"
      else -> null
    }

  private fun handleStartCapture(intent: Intent) {
    val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
    val data = getParcelableIntentExtra(intent, EXTRA_DATA)

    if (resultCode == 0 || data == null) {
      emitError("screen_capture_missing_result", IllegalArgumentException(OverlayText.t("screenCaptureMissingResult")))
      stopSelf()
      return
    }

    try {
      startAsForeground()
      captureSession?.release()
      captureSession = ScreenCaptureSession(
        context = applicationContext,
        resultCode = resultCode,
        data = data,
        language = targetLanguage,
        onStopped = ::handleProjectionStopped
      )
      emitStatus("screen_capture_started")
    } catch (error: Exception) {
      emitError("screen_capture_start_failed", error)
      stopSelf()
    }
  }

  private fun startAsForeground() {
    ensureNotificationChannel()

    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    isForeground = true
  }

  private fun handleProjectionStopped() {
    mainHandler.post {
      cancelAnalysisRuns()
      clearLookupState()
      captureSession = null
      widgetController?.removeAll()
      emitStatus("screen_capture_stopped")

      if (isForeground) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
          stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
          @Suppress("DEPRECATION")
          stopForeground(true)
        }
        isForeground = false
      }

      stopSelf()
    }
  }

  private fun handleTargetSelected(selectionTarget: OcrTapSelection) {
    val requestId = UUID.randomUUID().toString()
    clearLookupState()

    pendingLookupRequestId = requestId
    pendingSelectedTarget = selectionTarget
    widgetController?.showLookupLoading(requestId, selectionTarget)
    ScreenOcrOverlayModule.emitOverlayLookupRequested(
      mapOf(
        EXTRA_REQUEST_ID to requestId,
        EXTRA_SELECTED_TEXT to selectionTarget.selectedText,
        EXTRA_SELECTED_LINE_TEXT to selectionTarget.lineText,
        EXTRA_SELECTED_KIND to selectionTarget.kind,
        EXTRA_SELECTED_BOX to OcrSerializer.serializeBox(selectionTarget.box)
      )
    )
    emitStatus("overlay_lookup_requested")

    val timeoutRunnable = Runnable {
      if (pendingLookupRequestId != requestId) {
        return@Runnable
      }

      pendingLookupRequestId = null
      pendingLookupTimeoutRunnable = null
      widgetController?.showLookupError(
        requestId = requestId,
        message = OverlayText.t("openAppToLookup"),
        fallback = true
      )
      emitStatus("overlay_lookup_timeout")
    }
    pendingLookupTimeoutRunnable = timeoutRunnable
    mainHandler.postDelayed(timeoutRunnable, OVERLAY_LOOKUP_TIMEOUT_MS)
  }

  private fun handleTranslationRequested(requestId: String, query: String) {
    val lookupResult = currentLookupResult?.takeIf { it.requestId == requestId }
      ?: sentenceLookupResult(requestId, query)
      ?: return
    currentLookupResult = lookupResult

    val cleanedQuery = query.trim().ifBlank {
      if (lookupResult.sourceSentence.isNotBlank()) {
        lookupResult.sourceSentence
      } else {
        lookupResult.stem.ifBlank { lookupResult.surface }
      }
    }
    if (cleanedQuery.isBlank()) {
      return
    }

    ScreenOcrOverlayModule.emitOverlayTranslationRequested(
      mapOf(
        EXTRA_REQUEST_ID to requestId,
        "query" to cleanedQuery,
        "surface" to lookupResult.surface,
        "stem" to lookupResult.stem,
        "sourceSentence" to lookupResult.sourceSentence
      )
    )
    emitStatus("overlay_translation_requested")
  }

  private fun handleExplainRequested(requestId: String, word: String, sentence: String) {
    val cleanedWord = word.trim()
    if (cleanedWord.isBlank()) {
      return
    }

    ScreenOcrOverlayModule.emitOverlayExplainRequested(
      mapOf(
        EXTRA_REQUEST_ID to requestId,
        "word" to cleanedWord,
        "sentence" to sentence.trim()
      )
    )
    emitStatus("overlay_explain_requested")
  }

  private fun sentenceLookupResult(requestId: String, query: String): OverlayLookupResult? {
    val sentence = query.trim()
    if (sentence.isBlank() || widgetController?.hasLookupCard(requestId) != true) {
      return null
    }

    return OverlayLookupResult(
      requestId = requestId,
      surface = sentence,
      stem = sentence,
      definition = null,
      translation = null,
      translationSourceLanguage = null,
      translationTargetLanguage = null,
      explanation = null,
      explanationGloss = null,
      hanja = null,
      pos = null,
      romanization = null,
      saved = false,
      sourceSentence = sentence,
      alternatives = emptyList(),
      hanjaPreloads = emptyList(),
      wordOptions = emptyList()
    )
  }

  fun resolveOverlayLookup(requestId: String, result: Map<String, Any?>): Boolean {
    val lookupResult = parseLookupResult(requestId, result) ?: return false
    mainHandler.post {
      val isPending = pendingLookupRequestId == requestId
      val isVisible = widgetController?.hasLookupCard(requestId) == true
      if (!isPending && !isVisible) {
        return@post
      }

      if (isPending) {
        clearPendingLookupTimeout()
        pendingLookupRequestId = null
      }
      currentLookupResult = lookupResult
      widgetController?.showLookupResult(lookupResult)
      emitStatus("overlay_lookup_resolved")
    }
    return true
  }

  fun updateOverlayLookup(requestId: String, result: Map<String, Any?>): Boolean {
    mainHandler.post {
      val currentResult = currentLookupResult?.takeIf { it.requestId == requestId } ?: return@post
      val lookupResult = parseLookupResult(requestId, result, currentResult) ?: return@post

      currentLookupResult = lookupResult
      widgetController?.showLookupResult(lookupResult)
      emitStatus("overlay_lookup_updated")
    }
    return true
  }

  fun rejectOverlayLookup(requestId: String, message: String): Boolean {
    mainHandler.post {
      val isPending = pendingLookupRequestId == requestId
      val isVisible = widgetController?.hasLookupCard(requestId) == true
      if (!isPending && !isVisible) {
        return@post
      }

      if (isPending) {
        clearPendingLookupTimeout()
        pendingLookupRequestId = null
      }
      widgetController?.showLookupError(
        requestId = requestId,
        message = message.ifBlank { OverlayText.t("lookupFailed") },
        fallback = false
      )
      emitStatus("overlay_lookup_rejected")
    }
    return true
  }

  private fun handleSaveRequested(requestId: String, alternativeIndex: Int?) {
    val lookupResult = currentLookupResult?.takeIf { it.requestId == requestId }
    if (lookupResult == null) {
      widgetController?.showSaveError(requestId, OverlayText.t("lookupResultUnavailable"))
      return
    }
    val saveWord = if (alternativeIndex == null) {
      lookupResult.stem
    } else {
      lookupResult.alternatives.getOrNull(alternativeIndex)?.word.orEmpty()
    }
    val saveDefinition = if (alternativeIndex == null) {
      lookupResult.definition
    } else {
      lookupResult.alternatives.getOrNull(alternativeIndex)?.definition
    }
    val saveHanja = if (alternativeIndex == null) {
      lookupResult.hanja
    } else {
      lookupResult.alternatives.getOrNull(alternativeIndex)?.hanja
    }
    val savePos = if (alternativeIndex == null) {
      lookupResult.pos
    } else {
      lookupResult.alternatives.getOrNull(alternativeIndex)?.pos
    }
    val saveRomanization = if (alternativeIndex == null) {
      lookupResult.romanization
    } else {
      lookupResult.alternatives.getOrNull(alternativeIndex)?.romanization
    }
    val currentlySaved = if (alternativeIndex == null) {
      lookupResult.saved
    } else {
      lookupResult.alternatives.getOrNull(alternativeIndex)?.saved == true
    }

    if (saveWord.isBlank() || saveDefinition.isNullOrBlank()) {
      widgetController?.showSaveError(requestId, OverlayText.t("noDefinitionToSave"))
      return
    }

    clearPendingSaveTimeout()
    pendingSaveRequestId = requestId
    pendingSaveAlternativeIndex = alternativeIndex
    widgetController?.showSaving(requestId, alternativeIndex)
    ScreenOcrOverlayModule.emitOverlaySaveRequested(
      mapOf(
        EXTRA_REQUEST_ID to requestId,
        "surface" to lookupResult.surface,
        "stem" to saveWord,
        "definition" to saveDefinition,
        "hanja" to saveHanja,
        "pos" to savePos,
        "romanization" to saveRomanization,
        "sourceSentence" to lookupResult.sourceSentence,
        "alternativeIndex" to alternativeIndex,
        "action" to if (currentlySaved) "unsave" else "save"
      )
    )
    emitStatus("overlay_save_requested")

    val timeoutRunnable = Runnable {
      if (pendingSaveRequestId != requestId) {
        return@Runnable
      }

      pendingSaveRequestId = null
      pendingSaveAlternativeIndex = null
      widgetController?.showSaveError(requestId, OverlayText.t("saveTimedOut"))
      emitStatus("overlay_save_timeout")
    }
    pendingSaveTimeoutRunnable = timeoutRunnable
    mainHandler.postDelayed(timeoutRunnable, OVERLAY_SAVE_TIMEOUT_MS)
  }

  private fun handleExplainSaveRequested(requestId: String) {
    val lookupResult = currentLookupResult?.takeIf { it.requestId == requestId }
    if (lookupResult == null) {
      widgetController?.showSaveError(requestId, OverlayText.t("lookupResultUnavailable"))
      return
    }

    val saveWord = lookupResult.stem.ifBlank { lookupResult.surface }
    val saveDefinition = lookupResult.explanationGloss?.trim().orEmpty()
    if (saveWord.isBlank() || saveDefinition.isBlank()) {
      widgetController?.showSaveError(requestId, OverlayText.t("noDefinitionToSave"))
      return
    }

    clearPendingSaveTimeout()
    pendingSaveRequestId = requestId
    pendingSaveAlternativeIndex = null
    widgetController?.showSaving(requestId, null)
    ScreenOcrOverlayModule.emitOverlaySaveRequested(
      mapOf(
        EXTRA_REQUEST_ID to requestId,
        "surface" to lookupResult.surface,
        "stem" to saveWord,
        "definition" to saveDefinition,
        "hanja" to lookupResult.hanja,
        "pos" to lookupResult.pos,
        "romanization" to lookupResult.romanization,
        "sourceSentence" to lookupResult.sourceSentence,
        "alternativeIndex" to null,
        "action" to if (lookupResult.saved) "unsave" else "save"
      )
    )
    emitStatus("overlay_explain_save_requested")

    val timeoutRunnable = Runnable {
      if (pendingSaveRequestId != requestId) {
        return@Runnable
      }

      pendingSaveRequestId = null
      pendingSaveAlternativeIndex = null
      widgetController?.showSaveError(requestId, OverlayText.t("saveTimedOut"))
      emitStatus("overlay_save_timeout")
    }
    pendingSaveTimeoutRunnable = timeoutRunnable
    mainHandler.postDelayed(timeoutRunnable, OVERLAY_SAVE_TIMEOUT_MS)
  }

  fun resolveOverlaySave(requestId: String, result: Map<String, Any?>): Boolean {
    val saved = boolValue(result["saved"]) ?: true
    mainHandler.post {
      if (pendingSaveRequestId != requestId) {
        return@post
      }

      val alternativeIndex = pendingSaveAlternativeIndex
      clearPendingSaveTimeout()
      pendingSaveRequestId = null
      pendingSaveAlternativeIndex = null
      currentLookupResult = currentLookupResult?.takeIf { it.requestId == requestId }?.let { lookupResult ->
        if (alternativeIndex == null) {
          lookupResult.copy(saved = saved)
        } else {
          lookupResult.copy(
            alternatives = lookupResult.alternatives.mapIndexed { index, entry ->
              if (index == alternativeIndex) {
                entry.copy(saved = saved)
              } else {
                entry
              }
            }
          )
        }
      }
      widgetController?.showSaveResult(OverlaySaveResult(requestId, saved, alternativeIndex))
      emitStatus("overlay_save_resolved")
    }
    return true
  }

  fun rejectOverlaySave(requestId: String, message: String): Boolean {
    mainHandler.post {
      if (pendingSaveRequestId != requestId) {
        return@post
      }

      clearPendingSaveTimeout()
      pendingSaveRequestId = null
      pendingSaveAlternativeIndex = null
      widgetController?.showSaveError(requestId, message.ifBlank { OverlayText.t("saveFailed") })
      emitStatus("overlay_save_rejected")
    }
    return true
  }

  private fun handleHanjaRequested(character: String, sourceWord: String): String? {
    if (character.isBlank()) {
      return null
    }

    val requestId = UUID.randomUUID().toString()
    clearPendingHanjaTimeout()
    pendingHanjaRequestId = requestId
    widgetController?.showHanjaLoading(requestId, character, sourceWord)
    ScreenOcrOverlayModule.emitOverlayHanjaRequested(
      mapOf(
        EXTRA_REQUEST_ID to requestId,
        "character" to character,
        "sourceWord" to sourceWord
      )
    )
    emitStatus("overlay_hanja_requested")

    val timeoutRunnable = Runnable {
      if (pendingHanjaRequestId != requestId) {
        return@Runnable
      }

      pendingHanjaRequestId = null
      pendingHanjaTimeoutRunnable = null
      widgetController?.showHanjaError(requestId, OverlayText.t("hanjaLookupTimedOut"))
      emitStatus("overlay_hanja_timeout")
    }
    pendingHanjaTimeoutRunnable = timeoutRunnable
    mainHandler.postDelayed(timeoutRunnable, OVERLAY_HANJA_TIMEOUT_MS)
    return requestId
  }

  private fun handleRelatedKnownToggleRequested(
    sourceWord: String,
    sourceHanja: String,
    relatedWord: OverlayHanjaRelatedWord
  ) {
    ScreenOcrOverlayModule.emitOverlayRelatedKnownToggleRequested(
      mapOf(
        "sourceWord" to sourceWord,
        "sourceHanja" to sourceHanja,
        "known" to relatedWord.known,
        "relatedWord" to mapOf(
          "korean" to relatedWord.korean,
          "hanja" to relatedWord.hanja,
          "meaning" to relatedWord.meaning,
          "sourceHanja" to sourceHanja
        )
      )
    )
    emitStatus("overlay_related_known_toggle_requested")
  }

  fun resolveOverlayHanja(requestId: String, result: Map<String, Any?>): Boolean {
    val hanjaResult = parseHanjaResult(requestId, result) ?: return false
    mainHandler.post {
      val isPending = pendingHanjaRequestId == requestId
      val isVisible = widgetController?.hasHanjaPopup(requestId) == true
      if (!isPending && !isVisible) {
        return@post
      }

      if (isPending) {
        clearPendingHanjaTimeout()
        pendingHanjaRequestId = null
      }
      widgetController?.showHanjaResult(hanjaResult)
      emitStatus("overlay_hanja_resolved")
    }
    return true
  }

  fun rejectOverlayHanja(requestId: String, message: String): Boolean {
    mainHandler.post {
      val isPending = pendingHanjaRequestId == requestId
      val isVisible = widgetController?.hasHanjaPopup(requestId) == true
      if (!isPending && !isVisible) {
        return@post
      }

      if (isPending) {
        clearPendingHanjaTimeout()
        pendingHanjaRequestId = null
      }
      widgetController?.showHanjaError(requestId, message.ifBlank { OverlayText.t("hanjaLookupFailed") })
      emitStatus("overlay_hanja_rejected")
    }
    return true
  }

  private fun openSelectionInApp(selectionTarget: OcrTapSelection) {
    clearLookupState()
    val sourceBookTitle = OverlayText.t("floatingOcr")
    val selection = mapOf(
      EXTRA_SELECTION_ID to UUID.randomUUID().toString(),
      EXTRA_SELECTED_TEXT to selectionTarget.selectedText,
      EXTRA_SELECTED_LINE_TEXT to selectionTarget.lineText,
      EXTRA_SELECTED_KIND to selectionTarget.kind,
      EXTRA_SOURCE_BOOK_TITLE to sourceBookTitle,
      EXTRA_SELECTED_BOX to OcrSerializer.serializeBox(selectionTarget.box)
    )

    widgetController?.hideResultOverlay()
    restoreBubbleSafely()
    ScreenOcrOverlayModule.emitOcrWordSelected(selection)
    launchAppWithSelection(selection)
    emitStatus("ocr_word_selected")
  }

  private fun launchAppWithSelection(selection: Map<String, Any?>) {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return

    launchIntent.apply {
      action = ACTION_WORD_SELECTED
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      putExtra(EXTRA_SELECTION_ID, selection[EXTRA_SELECTION_ID] as? String)
      putExtra(EXTRA_SELECTED_TEXT, selection[EXTRA_SELECTED_TEXT] as? String)
      putExtra(EXTRA_SELECTED_LINE_TEXT, selection[EXTRA_SELECTED_LINE_TEXT] as? String)
      putExtra(EXTRA_SELECTED_KIND, selection[EXTRA_SELECTED_KIND] as? String)
      putExtra(EXTRA_SOURCE_BOOK_TITLE, selection[EXTRA_SOURCE_BOOK_TITLE] as? String ?: OverlayText.t("floatingOcr"))
      (selection[EXTRA_SELECTED_BOX] as? Map<*, *>)?.let { selectedBox ->
        putExtra(EXTRA_SELECTED_BOX_X, selectedBox["x"] as? Int ?: 0)
        putExtra(EXTRA_SELECTED_BOX_Y, selectedBox["y"] as? Int ?: 0)
        putExtra(EXTRA_SELECTED_BOX_WIDTH, selectedBox["width"] as? Int ?: 0)
        putExtra(EXTRA_SELECTED_BOX_HEIGHT, selectedBox["height"] as? Int ?: 0)
      }
    }

    try {
      startActivity(launchIntent)
    } catch (error: Exception) {
      emitError("launch_app_failed", error)
    }
  }

  private fun emitStatus(status: String) {
    ScreenOcrOverlayModule.emitOverlayStatus(
      mapOf(
        "status" to status,
        "overlayPermissionGranted" to Settings.canDrawOverlays(this),
        "screenCaptureActive" to (captureSession != null),
        "analysisActive" to isAnalyzing,
        "floatingVisible" to (widgetController?.isBubbleVisible == true),
        "resultOverlayVisible" to (widgetController?.isResultOverlayVisible == true)
      )
    )
  }

  private fun restoreBubbleSafely() {
    try {
      widgetController?.restoreBubbleIfNeeded()
    } catch (error: Exception) {
      emitError("restore_floating_widget_failed", error)
    }
  }

  private fun emitError(code: String, error: Exception) {
    ScreenOcrOverlayModule.emitOverlayError(
      mapOf(
        "code" to code,
        "message" to (error.message ?: code)
      )
    )
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(
      NOTIFICATION_CHANNEL_ID,
      OverlayText.t("floatingOcr"),
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = OverlayText.t("floatingOcrNotificationDescription")
      setShowBadge(false)
    }
    notificationManager.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: Intent()
    val pendingIntentFlags = PendingIntent.FLAG_UPDATE_CURRENT or
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    val pendingIntent = PendingIntent.getActivity(this, 0, launchIntent, pendingIntentFlags)
    val icon = applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.ic_menu_view

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
        .setContentTitle(OverlayText.t("floatingOcrNotificationTitle"))
        .setContentText(OverlayText.t("floatingOcrNotificationBody"))
        .setSmallIcon(icon)
        .setContentIntent(pendingIntent)
        .setOngoing(true)
        .build()
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
        .setContentTitle(OverlayText.t("floatingOcrNotificationTitle"))
        .setContentText(OverlayText.t("floatingOcrNotificationBody"))
        .setSmallIcon(icon)
        .setContentIntent(pendingIntent)
        .setOngoing(true)
        .build()
    }
  }

  companion object {
    const val ACTION_START_CAPTURE = "expo.modules.screenocroverlay.START_CAPTURE"
    const val ACTION_START_WIDGET = "expo.modules.screenocroverlay.START_WIDGET"
    const val ACTION_STOP_WIDGET = "expo.modules.screenocroverlay.STOP_WIDGET"
    const val ACTION_ANALYZE_CURRENT_SCREEN = "expo.modules.screenocroverlay.ANALYZE_CURRENT_SCREEN"
    const val ACTION_WORD_SELECTED = "expo.modules.screenocroverlay.WORD_SELECTED"

    const val EXTRA_RESULT_CODE = "expo.modules.screenocroverlay.RESULT_CODE"
    const val EXTRA_DATA = "expo.modules.screenocroverlay.DATA"
    const val EXTRA_REQUEST_ID = "requestId"
    const val EXTRA_SELECTION_ID = "selectionId"
    const val EXTRA_SELECTED_TEXT = "selectedText"
    const val EXTRA_SELECTED_LINE_TEXT = "selectedLineText"
    const val EXTRA_SELECTED_KIND = "selectedKind"
    const val EXTRA_SELECTED_BOX = "selectedBox"
    const val EXTRA_SOURCE_BOOK_TITLE = "sourceBookTitle"
    private const val EXTRA_SELECTED_BOX_X = "selectedBoxX"
    private const val EXTRA_SELECTED_BOX_Y = "selectedBoxY"
    private const val EXTRA_SELECTED_BOX_WIDTH = "selectedBoxWidth"
    private const val EXTRA_SELECTED_BOX_HEIGHT = "selectedBoxHeight"

    private const val NOTIFICATION_CHANNEL_ID = "screen_ocr_overlay"
    private const val NOTIFICATION_ID = 8742
    @Volatile
    private var activeInstance: ScreenOcrOverlayService? = null

    // The learner's target language (mirrors the Profile page), pushed from JS and
    // read when a capture session starts to pick the matching OCR recognizer.
    @Volatile
    private var targetLanguage: String? = null

    fun setTargetLanguage(language: String?) {
      targetLanguage = language
      // Redraw the floating bubble so its language badge tracks the new mode.
      activeInstance?.handleTargetLanguageChanged()
    }

    fun getTargetLanguage(): String? = targetLanguage

    fun getActiveInstance(): ScreenOcrOverlayService? = activeInstance

    fun isCaptureActive(): Boolean = activeInstance?.isScreenCaptureActive() == true

    fun startCapture(context: Context, resultCode: Int, data: Intent) {
      val serviceIntent = Intent(context, ScreenOcrOverlayService::class.java).apply {
        action = ACTION_START_CAPTURE
        putExtra(EXTRA_RESULT_CODE, resultCode)
        putExtra(EXTRA_DATA, data)
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(serviceIntent)
      } else {
        context.startService(serviceIntent)
      }
    }

    fun selectionFromIntent(intent: Intent?): Map<String, Any?>? {
      if (intent == null) {
        return null
      }

      val selectedText = intent.getStringExtra(EXTRA_SELECTED_TEXT)?.trim().orEmpty()
      if (selectedText.isEmpty()) {
        return null
      }

      return mapOf(
        EXTRA_SELECTION_ID to intent.getStringExtra(EXTRA_SELECTION_ID),
        EXTRA_SELECTED_TEXT to selectedText,
        EXTRA_SELECTED_LINE_TEXT to intent.getStringExtra(EXTRA_SELECTED_LINE_TEXT).orEmpty(),
        EXTRA_SELECTED_KIND to intent.getStringExtra(EXTRA_SELECTED_KIND).orEmpty(),
        EXTRA_SELECTED_BOX to selectedBoxFromIntent(intent),
        EXTRA_SOURCE_BOOK_TITLE to intent.getStringExtra(EXTRA_SOURCE_BOOK_TITLE).orEmpty().ifEmpty { OverlayText.t("floatingOcr") }
      )
    }

    fun clearSelectionExtras(intent: Intent?) {
      intent ?: return
      intent.removeExtra(EXTRA_SELECTION_ID)
      intent.removeExtra(EXTRA_SELECTED_TEXT)
      intent.removeExtra(EXTRA_SELECTED_LINE_TEXT)
      intent.removeExtra(EXTRA_SELECTED_KIND)
      intent.removeExtra(EXTRA_SELECTED_BOX_X)
      intent.removeExtra(EXTRA_SELECTED_BOX_Y)
      intent.removeExtra(EXTRA_SELECTED_BOX_WIDTH)
      intent.removeExtra(EXTRA_SELECTED_BOX_HEIGHT)
      intent.removeExtra(EXTRA_SOURCE_BOOK_TITLE)
    }

    private fun selectedBoxFromIntent(intent: Intent): Map<String, Int>? {
      if (!intent.hasExtra(EXTRA_SELECTED_BOX_WIDTH) || !intent.hasExtra(EXTRA_SELECTED_BOX_HEIGHT)) {
        return null
      }

      val width = intent.getIntExtra(EXTRA_SELECTED_BOX_WIDTH, 0)
      val height = intent.getIntExtra(EXTRA_SELECTED_BOX_HEIGHT, 0)
      if (width <= 0 || height <= 0) {
        return null
      }

      return mapOf(
        "x" to intent.getIntExtra(EXTRA_SELECTED_BOX_X, 0),
        "y" to intent.getIntExtra(EXTRA_SELECTED_BOX_Y, 0),
        "width" to width,
        "height" to height
      )
    }

    @Suppress("DEPRECATION")
    private fun getParcelableIntentExtra(intent: Intent, key: String): Intent? =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableExtra(key, Intent::class.java)
      } else {
        intent.getParcelableExtra(key)
      }
  }
}
