package expo.modules.screenocroverlay

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

private const val SCREEN_CAPTURE_REQUEST_CODE = 8274
private const val START_WIDGET_CAPTURE_WAIT_ATTEMPTS = 25
private const val START_WIDGET_CAPTURE_WAIT_DELAY_MS = 120L

class ScreenOcrOverlayModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val currentActivity: Activity
    get() = appContext.currentActivity ?: throw Exceptions.MissingActivity()

  private var pendingOverlayPermissionPromise: Promise? = null
  private var pendingScreenCapturePromise: Promise? = null
  private var lastSelectionId: String? = null

  override fun definition() = ModuleDefinition {
    Name("ScreenOcrOverlay")

    Events(
      "onOverlayStatus",
      "onOcrResult",
      "onOcrWordSelected",
      "onOverlayLookupRequested",
      "onOverlayTranslationRequested",
      "onOverlayExplainRequested",
      "onOverlaySaveRequested",
      "onOverlayHanjaRequested",
      "onOverlayRelatedKnownToggleRequested",
      "onOverlayError"
    )

    OnCreate {
      activeModule = WeakReference(this@ScreenOcrOverlayModule)
    }

    OnDestroy {
      if (activeModule?.get() === this@ScreenOcrOverlayModule) {
        activeModule = null
      }
    }

    // `strings` carries the active interface language's overlay strings, built
    // from the JS i18n tables (see modules/screen-ocr-overlay/src/index.js).
    // It's optional so an older/failed bundle just falls back to English.
    Function("setInterfaceLanguage") { language: String, strings: Map<String, String>? ->
      OverlayText.setLanguage(language)
      if (strings != null) {
        OverlayText.setStrings(strings)
      }
      ScreenOcrOverlayService.getActiveInstance()?.handleInterfaceLanguageChanged()
      OverlayText.currentLanguage()
    }

    // The target language (Profile page) selects the OCR recognizer script. Stored
    // statically and read when a capture session starts; a live session keeps the
    // recognizer it began with until the widget is restarted.
    Function("setTargetLanguage") { language: String ->
      ScreenOcrOverlayService.setTargetLanguage(language)
      language
    }

    AsyncFunction("requestOverlayPermission") { promise: Promise ->
      if (Settings.canDrawOverlays(context)) {
        promise.resolve(mapOf("granted" to true))
        emitCurrentStatus("overlay_permission_granted")
        return@AsyncFunction
      }

      if (pendingOverlayPermissionPromise != null) {
        promise.reject("E_OVERLAY_PERMISSION_IN_PROGRESS", OverlayText.t("overlayPermissionInProgress"), null)
        return@AsyncFunction
      }

      pendingOverlayPermissionPromise = promise
      val settingsIntent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${context.packageName}")
      )
      currentActivity.startActivity(settingsIntent)
    }

    Function("isOverlayPermissionGranted") {
      Settings.canDrawOverlays(context)
    }

    AsyncFunction("requestScreenCapture") { promise: Promise ->
      if (pendingScreenCapturePromise != null) {
        promise.reject("E_SCREEN_CAPTURE_IN_PROGRESS", OverlayText.t("screenCaptureInProgress"), null)
        return@AsyncFunction
      }

      pendingScreenCapturePromise = promise
      val projectionManager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      currentActivity.startActivityForResult(
        projectionManager.createScreenCaptureIntent(),
        SCREEN_CAPTURE_REQUEST_CODE
      )
    }

    Function("isScreenCaptureActive") {
      ScreenOcrOverlayService.isCaptureActive()
    }

    AsyncFunction("startFloatingWidget") { promise: Promise ->
      if (!Settings.canDrawOverlays(context)) {
        val message = OverlayText.t("grantOverlayPermissionBeforeFloatingWidget")
        promise.reject("E_OVERLAY_PERMISSION_DENIED", message, null)
        emitOverlayError(
          mapOf(
            "code" to "overlay_permission_denied",
            "message" to message
          )
        )
        return@AsyncFunction
      }

      startFloatingWidgetWhenCaptureReady(promise)
    }

    AsyncFunction("stopFloatingWidget") { promise: Promise ->
      val visible = ScreenOcrOverlayService.getActiveInstance()?.stopFloatingWidget() ?: false
      promise.resolve(mapOf("visible" to visible))
    }

    AsyncFunction("analyzeCurrentScreen") { promise: Promise ->
      val service = ScreenOcrOverlayService.getActiveInstance()
      if (service == null || !service.isScreenCaptureActive()) {
        promise.reject("E_SCREEN_CAPTURE_INACTIVE", OverlayText.t("requestScreenCaptureBeforeAnalyzing"), null)
        return@AsyncFunction
      }

      service.analyzeCurrentScreenForPromise(promise)
    }

    AsyncFunction("resolveOverlayLookup") { requestId: String, result: Map<String, Any?>, promise: Promise ->
      val handled = ScreenOcrOverlayService.getActiveInstance()?.resolveOverlayLookup(requestId, result) == true
      promise.resolve(mapOf("handled" to handled))
    }

    AsyncFunction("updateOverlayLookup") { requestId: String, result: Map<String, Any?>, promise: Promise ->
      val handled = ScreenOcrOverlayService.getActiveInstance()?.updateOverlayLookup(requestId, result) == true
      promise.resolve(mapOf("handled" to handled))
    }

    AsyncFunction("rejectOverlayLookup") { requestId: String, message: String, promise: Promise ->
      val handled = ScreenOcrOverlayService.getActiveInstance()?.rejectOverlayLookup(requestId, message) == true
      promise.resolve(mapOf("handled" to handled))
    }

    AsyncFunction("resolveOverlaySave") { requestId: String, result: Map<String, Any?>, promise: Promise ->
      val handled = ScreenOcrOverlayService.getActiveInstance()?.resolveOverlaySave(requestId, result) == true
      promise.resolve(mapOf("handled" to handled))
    }

    AsyncFunction("rejectOverlaySave") { requestId: String, message: String, promise: Promise ->
      val handled = ScreenOcrOverlayService.getActiveInstance()?.rejectOverlaySave(requestId, message) == true
      promise.resolve(mapOf("handled" to handled))
    }

    AsyncFunction("resolveOverlayHanja") { requestId: String, result: Map<String, Any?>, promise: Promise ->
      val handled = ScreenOcrOverlayService.getActiveInstance()?.resolveOverlayHanja(requestId, result) == true
      promise.resolve(mapOf("handled" to handled))
    }

    AsyncFunction("rejectOverlayHanja") { requestId: String, message: String, promise: Promise ->
      val handled = ScreenOcrOverlayService.getActiveInstance()?.rejectOverlayHanja(requestId, message) == true
      promise.resolve(mapOf("handled" to handled))
    }

    OnActivityResult { _, (requestCode, resultCode, data) ->
      if (requestCode != SCREEN_CAPTURE_REQUEST_CODE) {
        return@OnActivityResult
      }

      val promise = pendingScreenCapturePromise ?: return@OnActivityResult
      pendingScreenCapturePromise = null

      if (resultCode == Activity.RESULT_OK && data != null) {
        try {
          ScreenOcrOverlayService.startCapture(context, resultCode, data)
          promise.resolve(mapOf("granted" to true, "active" to true))
          emitCurrentStatus("screen_capture_requested")
        } catch (error: Exception) {
          promise.reject("E_SCREEN_CAPTURE_START_FAILED", error.message, error)
          emitOverlayError(
            mapOf(
              "code" to "screen_capture_start_failed",
              "message" to (error.message ?: OverlayText.t("screenCaptureCouldNotStart"))
            )
          )
        }
      } else {
        promise.resolve(mapOf("granted" to false, "active" to false))
        emitCurrentStatus("screen_capture_denied")
      }
    }

    OnActivityEntersForeground {
      resolvePendingOverlayPermission()
      consumeWordSelectionIntent(appContext.currentActivity?.intent)
    }

    OnNewIntent { intent ->
      consumeWordSelectionIntent(intent)
    }
  }

  private fun resolvePendingOverlayPermission() {
    val promise = pendingOverlayPermissionPromise ?: return
    pendingOverlayPermissionPromise = null
    val granted = Settings.canDrawOverlays(context)
    promise.resolve(mapOf("granted" to granted))
    emitCurrentStatus(if (granted) "overlay_permission_granted" else "overlay_permission_denied")
  }

  private fun startFloatingWidgetWhenCaptureReady(promise: Promise, attempt: Int = 0) {
    val service = ScreenOcrOverlayService.getActiveInstance()
    if (service?.isScreenCaptureActive() == true) {
      val visible = service.showFloatingWidget()
      promise.resolve(mapOf(
        "visible" to visible,
        "screenCaptureActive" to true
      ))
      return
    }

    if (attempt >= START_WIDGET_CAPTURE_WAIT_ATTEMPTS) {
      promise.reject("E_SCREEN_CAPTURE_INACTIVE", OverlayText.t("requestScreenCaptureBeforeFloatingWidget"), null)
      return
    }

    mainHandler.postDelayed({
      startFloatingWidgetWhenCaptureReady(promise, attempt + 1)
    }, START_WIDGET_CAPTURE_WAIT_DELAY_MS)
  }

  private fun consumeWordSelectionIntent(intent: Intent?) {
    val selection = ScreenOcrOverlayService.selectionFromIntent(intent) ?: return
    val selectionId = selection[ScreenOcrOverlayService.EXTRA_SELECTION_ID] as? String

    if (selectionId != null && selectionId == lastSelectionId) {
      ScreenOcrOverlayService.clearSelectionExtras(intent)
      return
    }

    lastSelectionId = selectionId
    emitOcrWordSelected(selection)
    ScreenOcrOverlayService.clearSelectionExtras(intent)
  }

  private fun emitCurrentStatus(status: String) {
    emitOverlayStatus(
      mapOf(
        "status" to status,
        "overlayPermissionGranted" to Settings.canDrawOverlays(context),
        "screenCaptureActive" to ScreenOcrOverlayService.isCaptureActive(),
        "analysisActive" to (ScreenOcrOverlayService.getActiveInstance()?.isAnalysisActive() == true),
        "floatingVisible" to (ScreenOcrOverlayService.getActiveInstance()?.isFloatingWidgetVisible() == true),
        "resultOverlayVisible" to (ScreenOcrOverlayService.getActiveInstance()?.isResultOverlayVisible() == true)
      )
    )
  }

  companion object {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var activeModule: WeakReference<ScreenOcrOverlayModule>? = null

    fun emitOverlayStatus(body: Map<String, Any?>) {
      emit("onOverlayStatus", body)
    }

    fun emitOcrResult(body: Map<String, Any?>) {
      emit("onOcrResult", body)
    }

    fun emitOcrWordSelected(body: Map<String, Any?>) {
      emit("onOcrWordSelected", body)
    }

    fun emitOverlayLookupRequested(body: Map<String, Any?>) {
      emit("onOverlayLookupRequested", body)
    }

    fun emitOverlayTranslationRequested(body: Map<String, Any?>) {
      emit("onOverlayTranslationRequested", body)
    }

    fun emitOverlayExplainRequested(body: Map<String, Any?>) {
      emit("onOverlayExplainRequested", body)
    }

    fun emitOverlaySaveRequested(body: Map<String, Any?>) {
      emit("onOverlaySaveRequested", body)
    }

    fun emitOverlayHanjaRequested(body: Map<String, Any?>) {
      emit("onOverlayHanjaRequested", body)
    }

    fun emitOverlayRelatedKnownToggleRequested(body: Map<String, Any?>) {
      emit("onOverlayRelatedKnownToggleRequested", body)
    }

    fun emitOverlayError(body: Map<String, Any?>) {
      emit("onOverlayError", body)
    }

    private fun emit(name: String, body: Map<String, Any?>) {
      mainHandler.post {
        activeModule?.get()?.sendEvent(name, body)
      }
    }
  }
}
