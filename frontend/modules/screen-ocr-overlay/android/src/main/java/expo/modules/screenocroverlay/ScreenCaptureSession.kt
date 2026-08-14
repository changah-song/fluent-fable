package expo.modules.screenocroverlay

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer

private const val IMAGE_ACQUIRE_ATTEMPTS = 9
private const val IMAGE_ACQUIRE_DELAY_MS = 80L
private const val DEBUG_BOX_LOG_LIMIT = 10
private const val OCR_CAPTURE_DEBUG_ENABLED = false
private const val OCR_CAPTURE_TIMING_ENABLED = true
private const val TAG = "ScreenOcrCapture"

class ScreenCaptureSession(
  private val context: Context,
  resultCode: Int,
  data: Intent,
  private val language: String?,
  private val onStopped: () -> Unit
) {
  private val captureLock = Any()
  private val mainHandler = Handler(Looper.getMainLooper())
  // The recognizer script matches the profile target language captured at session
  // start; switching languages while the overlay is live needs a widget restart.
  private val recognizer = OcrRecognizers.create(language)
  private val projection: MediaProjection
  private var imageReader: ImageReader
  private var virtualDisplay: VirtualDisplay
  private val callback = object : MediaProjection.Callback() {
    override fun onStop() {
      release(stopProjection = false)
      onStopped()
    }

    override fun onCapturedContentResize(width: Int, height: Int) {
      if (width <= 0 || height <= 0) {
        return
      }

      mainHandler.post {
        resizeCapture(width, height)
      }
    }
  }
  private var released = false

  private var captureWidth: Int
  private var captureHeight: Int
  private val densityDpi: Int

  init {
    val metrics = resolveCaptureMetrics(context)
    captureWidth = metrics.width
    captureHeight = metrics.height
    densityDpi = metrics.densityDpi

    val projectionManager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    projection = projectionManager.getMediaProjection(resultCode, data)
      ?: throw IllegalStateException(OverlayText.t("mediaProjectionCreateFailed"))

    imageReader = createImageReader(captureWidth, captureHeight)
    projection.registerCallback(callback, mainHandler)
    virtualDisplay = projection.createVirtualDisplay(
      "FluentFableScreenOcr",
      captureWidth,
      captureHeight,
      densityDpi,
      DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
      imageReader.surface,
      null,
      mainHandler
    ) ?: throw IllegalStateException(OverlayText.t("virtualDisplayCreateFailed"))
  }

  fun analyzeLatestImage(cropBounds: OverlayCaptureBounds? = null): SerializedOcrResult {
    check(!released) { OverlayText.t("screenCaptureSessionInactive") }

    val totalStartNs = SystemClock.elapsedRealtimeNanos()
    val image = acquireLatestImageWithRetry()
      ?: throw IllegalStateException(OverlayText.t("noScreenImageAvailable"))
    val acquireEndNs = SystemClock.elapsedRealtimeNanos()

    image.use { currentImage ->
      val bitmapStartNs = SystemClock.elapsedRealtimeNanos()
      val capturedBitmap = currentImage.toBitmap(cropBounds)
      val bitmapEndNs = SystemClock.elapsedRealtimeNanos()
      val ocrBitmap = capturedBitmap.bitmap
      return try {
        val appliedCropBounds = capturedBitmap.cropBounds
        val inputImage = InputImage.fromBitmap(ocrBitmap, 0)
        val recognizeStartNs = SystemClock.elapsedRealtimeNanos()
        val ocrResult = Tasks.await(recognizer.process(inputImage))
        val recognizeEndNs = SystemClock.elapsedRealtimeNanos()
        val serializeStartNs = SystemClock.elapsedRealtimeNanos()
        val serialized = OcrSerializer.serialize(
          result = ocrResult,
          imageWidth = ocrBitmap.width,
          imageHeight = ocrBitmap.height,
          language = language,
          filterTopChrome = appliedCropBounds == null,
          includeText = OCR_CAPTURE_DEBUG_ENABLED,
          includeBlocks = OCR_CAPTURE_DEBUG_ENABLED,
          includeDebugBoxes = OCR_CAPTURE_DEBUG_ENABLED
        )
        val serializeEndNs = SystemClock.elapsedRealtimeNanos()
        val refineStartNs = SystemClock.elapsedRealtimeNanos()
        val refinedSerialized = OcrBoxRefiner.refine(serialized, ocrBitmap)
        val refineEndNs = SystemClock.elapsedRealtimeNanos()
        val timedSerialized = withCaptureTiming(
          serialized = refinedSerialized,
          timing = buildCaptureTiming(
            totalStartNs = totalStartNs,
            acquireEndNs = acquireEndNs,
            bitmapStartNs = bitmapStartNs,
            bitmapEndNs = bitmapEndNs,
            recognizeStartNs = recognizeStartNs,
            recognizeEndNs = recognizeEndNs,
            serializeStartNs = serializeStartNs,
            serializeEndNs = serializeEndNs,
            refineStartNs = refineStartNs,
            refineEndNs = refineEndNs,
            capturedWidth = currentImage.width,
            capturedHeight = currentImage.height,
            ocrBitmap = ocrBitmap,
            cropBounds = appliedCropBounds,
            targetCount = refinedSerialized.targets.size
          )
        )

        if (!OCR_CAPTURE_DEBUG_ENABLED) {
          timedSerialized
        } else {
          val debugBitmapPath = saveDebugBitmap(ocrBitmap, timedSerialized.debugBoxes)
          val debugInfo = buildDebugInfo(
            capturedWidth = currentImage.width,
            capturedHeight = currentImage.height,
            ocrBitmap = ocrBitmap,
            cropBounds = appliedCropBounds,
            serialized = timedSerialized,
            debugBitmapPath = debugBitmapPath
          )

          logCaptureGeometry(
            capturedWidth = currentImage.width,
            capturedHeight = currentImage.height,
            ocrBitmap = ocrBitmap,
            cropBounds = appliedCropBounds,
            serialized = timedSerialized,
            debugBitmapPath = debugBitmapPath
          )
          timedSerialized.copy(
            result = timedSerialized.result + mapOf(
              "debugOverlayBitmapUri" to debugBitmapPath?.let { File(it).toURI().toString() },
              "debug" to debugInfo
            )
          )
        }
      } finally {
        ocrBitmap.recycle()
      }
    }
  }

  fun release() {
    release(stopProjection = true)
  }

  private fun release(stopProjection: Boolean) {
    if (released) {
      return
    }

    synchronized(captureLock) {
      released = true

      try {
        virtualDisplay.release()
      } catch (_: Exception) {
      }

      try {
        imageReader.close()
      } catch (_: Exception) {
      }
    }

    try {
      projection.unregisterCallback(callback)
    } catch (_: Exception) {
    }

    if (stopProjection) {
      try {
        projection.stop()
      } catch (_: Exception) {
      }
    }

    try {
      recognizer.close()
    } catch (_: Exception) {
    }
  }

  private fun acquireLatestImageWithRetry(): Image? {
    repeat(IMAGE_ACQUIRE_ATTEMPTS) { attempt ->
      try {
        synchronized(captureLock) {
          if (released) {
            return null
          }
          imageReader.acquireLatestImage()
        }?.let { return it }
      } catch (_: IllegalStateException) {
      }

      if (attempt < IMAGE_ACQUIRE_ATTEMPTS - 1) {
        Thread.sleep(IMAGE_ACQUIRE_DELAY_MS)
      }
    }

    return null
  }

  private fun resizeCapture(width: Int, height: Int) {
    synchronized(captureLock) {
      if (released || width == captureWidth && height == captureHeight) {
        return
      }

      val nextImageReader = createImageReader(width, height)
      val previousImageReader = imageReader

      try {
        virtualDisplay.resize(width, height, densityDpi)
        virtualDisplay.setSurface(nextImageReader.surface)
        imageReader = nextImageReader
        captureWidth = width
        captureHeight = height
        previousImageReader.close()
        Log.d(TAG, "captured content resized to ${width}x$height density=$densityDpi")
      } catch (error: Exception) {
        nextImageReader.close()
        Log.w(TAG, "failed to resize captured content to ${width}x$height", error)
      }
    }
  }

  private fun createImageReader(width: Int, height: Int): ImageReader =
    ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)

  private fun Image.toBitmap(cropBounds: OverlayCaptureBounds? = null): CapturedBitmap {
    val plane = planes.firstOrNull()
      ?: throw IllegalStateException(OverlayText.t("screenCaptureNoPixelPlane"))
    val buffer = plane.buffer
    val pixelStride = plane.pixelStride
    val rowStride = plane.rowStride
    val appliedCropBounds = sanitizeCropBounds(cropBounds, width, height)
    val cropLeft = appliedCropBounds?.left ?: 0
    val cropTop = appliedCropBounds?.top ?: 0
    val cropWidth = appliedCropBounds?.width ?: width
    val cropHeight = appliedCropBounds?.height ?: height

    if (pixelStride != 4) {
      throw IllegalStateException(OverlayText.unsupportedPixelStride(pixelStride))
    }

    buffer.rewind()
    val bitmap = Bitmap.createBitmap(cropWidth, cropHeight, Bitmap.Config.ARGB_8888)
    val rowByteCount = cropWidth * pixelStride

    if (appliedCropBounds == null && rowStride == rowByteCount && buffer.remaining() >= rowByteCount * cropHeight) {
      bitmap.copyPixelsFromBuffer(buffer)
      return CapturedBitmap(bitmap = bitmap, cropBounds = null)
    }

    val output = ByteBuffer.allocate(rowByteCount * cropHeight)
    val rowBuffer = ByteArray(rowByteCount)

    for (row in 0 until cropHeight) {
      val rowStart = (cropTop + row) * rowStride + cropLeft * pixelStride
      if (rowStart < 0 || rowStart + rowByteCount > buffer.capacity()) {
        throw IllegalStateException(OverlayText.t("screenCaptureRowOutsideBuffer"))
      }
      buffer.position(rowStart)
      buffer.get(rowBuffer, 0, rowByteCount)
      output.put(rowBuffer)
    }

    output.rewind()
    bitmap.copyPixelsFromBuffer(output)
    return CapturedBitmap(bitmap = bitmap, cropBounds = appliedCropBounds)
  }

  private fun withCaptureTiming(
    serialized: SerializedOcrResult,
    timing: Map<String, Any?>
  ): SerializedOcrResult {
    if (!OCR_CAPTURE_TIMING_ENABLED) {
      return serialized
    }

    return serialized.copy(result = serialized.result + mapOf("timing" to timing))
  }

  private fun buildCaptureTiming(
    totalStartNs: Long,
    acquireEndNs: Long,
    bitmapStartNs: Long,
    bitmapEndNs: Long,
    recognizeStartNs: Long,
    recognizeEndNs: Long,
    serializeStartNs: Long,
    serializeEndNs: Long,
    refineStartNs: Long,
    refineEndNs: Long,
    capturedWidth: Int,
    capturedHeight: Int,
    ocrBitmap: Bitmap,
    cropBounds: OverlayCaptureBounds?,
    targetCount: Int
  ): Map<String, Any?> =
    mapOf(
      "acquireMs" to elapsedMs(totalStartNs, acquireEndNs),
      "bitmapMs" to elapsedMs(bitmapStartNs, bitmapEndNs),
      "recognizeMs" to elapsedMs(recognizeStartNs, recognizeEndNs),
      "serializeMs" to elapsedMs(serializeStartNs, serializeEndNs),
      "targetRefineMs" to elapsedMs(refineStartNs, refineEndNs),
      "totalMs" to elapsedMs(totalStartNs, refineEndNs),
      "targetCount" to targetCount,
      "capturedWidth" to capturedWidth,
      "capturedHeight" to capturedHeight,
      "ocrBitmapWidth" to ocrBitmap.width,
      "ocrBitmapHeight" to ocrBitmap.height,
      "cropped" to (cropBounds != null)
    )

  private fun elapsedMs(startNs: Long, endNs: Long): Double =
    (endNs - startNs).coerceAtLeast(0L).toDouble() / 1_000_000.0

  private fun sanitizeCropBounds(
    cropBounds: OverlayCaptureBounds?,
    sourceWidth: Int,
    sourceHeight: Int
  ): OverlayCaptureBounds? {
    if (cropBounds == null || cropBounds.width <= 0 || cropBounds.height <= 0) {
      return null
    }

    val cropLeft = cropBounds.left.coerceIn(0, sourceWidth - 1)
    val cropTop = cropBounds.top.coerceIn(0, sourceHeight - 1)
    val cropWidth = cropBounds.width.coerceAtMost(sourceWidth - cropLeft).coerceAtLeast(1)
    val cropHeight = cropBounds.height.coerceAtMost(sourceHeight - cropTop).coerceAtLeast(1)

    return OverlayCaptureBounds(
      left = cropLeft,
      top = cropTop,
      width = cropWidth,
      height = cropHeight
    )
  }

  private fun buildDebugInfo(
    capturedWidth: Int,
    capturedHeight: Int,
    ocrBitmap: Bitmap,
    cropBounds: OverlayCaptureBounds?,
    serialized: SerializedOcrResult,
    debugBitmapPath: String?
  ): Map<String, Any?> =
    mapOf(
      "capturedBitmapWidth" to capturedWidth,
      "capturedBitmapHeight" to capturedHeight,
      "ocrBitmapWidth" to ocrBitmap.width,
      "ocrBitmapHeight" to ocrBitmap.height,
      "overlayCaptureBounds" to cropBounds?.toMap(),
      "readerWidth" to captureWidth,
      "readerHeight" to captureHeight,
      "displayRotation" to displayRotation(),
      "windowBounds" to windowBoundsDebug(),
      "targetCount" to serialized.targets.size,
      "debugBoxCount" to serialized.debugBoxes.size,
      "debugOverlayBitmapPath" to debugBitmapPath,
      "firstBoxes" to serialized.debugBoxes
        .take(DEBUG_BOX_LOG_LIMIT)
        .map(OcrSerializer::serializeDebugBox)
    )

  private fun logCaptureGeometry(
    capturedWidth: Int,
    capturedHeight: Int,
    ocrBitmap: Bitmap,
    cropBounds: OverlayCaptureBounds?,
    serialized: SerializedOcrResult,
    debugBitmapPath: String?
  ) {
    val firstBoxes = serialized.debugBoxes
      .take(DEBUG_BOX_LOG_LIMIT)
      .joinToString(separator = " | ") { box ->
        "${box.kind}:${box.accepted}:${box.text.take(28)}@${box.box.flattenToString()}"
      }

    Log.d(
      TAG,
      "fullBitmap=${capturedWidth}x$capturedHeight " +
        "overlayBounds=${cropBounds?.toLogString() ?: "none"} " +
        "ocrBitmap=${ocrBitmap.width}x${ocrBitmap.height} " +
        "overlayView=${cropBounds?.let { "${it.width}x${it.height}" } ?: "unknown"} " +
        "reader=${captureWidth}x${captureHeight} " +
        "rotation=${displayRotation()} " +
        "bounds=${windowBoundsDebug()} " +
        "targets=${serialized.targets.size} debugBoxes=${serialized.debugBoxes.size} " +
        "debugBitmap=$debugBitmapPath " +
        "firstBoxes=$firstBoxes"
    )
  }

  private fun saveDebugBitmap(bitmap: Bitmap, debugBoxes: List<OcrDebugBox>): String? {
    return try {
      val debugBitmap = bitmap.copy(Bitmap.Config.ARGB_8888, true)
      val canvas = Canvas(debugBitmap)
      val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(230, 47, 125, 76)
        strokeWidth = 3f
        style = Paint.Style.STROKE
      }
      val filteredPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(210, 200, 125, 0)
        strokeWidth = 2f
        style = Paint.Style.STROKE
      }
      val elementPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(145, 0, 122, 255)
        strokeWidth = 1f
        style = Paint.Style.STROKE
      }

      debugBoxes.forEach { debugBox ->
        val paint = when {
          debugBox.kind == "element" -> elementPaint
          debugBox.accepted -> linePaint
          else -> filteredPaint
        }
        canvas.drawRect(debugBox.box, paint)
      }

      val debugDir = File(context.cacheDir, "screen-ocr-overlay").apply {
        mkdirs()
      }
      val debugFile = File(debugDir, "last-ocr-debug.png")
      FileOutputStream(debugFile).use { output ->
        debugBitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
      }
      debugBitmap.recycle()
      debugFile.absolutePath
    } catch (error: Exception) {
      Log.w(TAG, "failed to save OCR debug bitmap", error)
      null
    }
  }

  @Suppress("DEPRECATION")
  private fun displayRotation(): Int {
    val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    return windowManager.defaultDisplay.rotation
  }

  private fun windowBoundsDebug(): Map<String, Any?> {
    val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val currentBounds = windowManager.currentWindowMetrics.bounds
      val maxBounds = windowManager.maximumWindowMetrics.bounds
      mapOf(
        "current" to "${currentBounds.width()}x${currentBounds.height()}@${currentBounds.left},${currentBounds.top}",
        "maximum" to "${maxBounds.width()}x${maxBounds.height()}@${maxBounds.left},${maxBounds.top}"
      )
    } else {
      val metrics = DisplayMetrics()
      @Suppress("DEPRECATION")
      windowManager.defaultDisplay.getRealMetrics(metrics)
      mapOf(
        "current" to "${metrics.widthPixels}x${metrics.heightPixels}@0,0",
        "maximum" to "${metrics.widthPixels}x${metrics.heightPixels}@0,0"
      )
    }
  }
}

private data class CaptureMetrics(
  val width: Int,
  val height: Int,
  val densityDpi: Int
)

private data class CapturedBitmap(
  val bitmap: Bitmap,
  val cropBounds: OverlayCaptureBounds?
)

private fun resolveCaptureMetrics(context: Context): CaptureMetrics {
  val displayMetrics = context.resources.displayMetrics
  val densityDpi = displayMetrics.densityDpi.takeIf { it > 0 } ?: DisplayMetrics.DENSITY_DEFAULT

  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
    val windowManager = context.getSystemService(WindowManager::class.java)
    val bounds = windowManager.maximumWindowMetrics.bounds

    return CaptureMetrics(
      width = bounds.width().coerceAtLeast(1),
      height = bounds.height().coerceAtLeast(1),
      densityDpi = densityDpi
    )
  }

  @Suppress("DEPRECATION")
  val legacyWindowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  val metrics = DisplayMetrics()
  @Suppress("DEPRECATION")
  legacyWindowManager.defaultDisplay.getRealMetrics(metrics)

  return CaptureMetrics(
    width = metrics.widthPixels.coerceAtLeast(1),
    height = metrics.heightPixels.coerceAtLeast(1),
    densityDpi = metrics.densityDpi.takeIf { it > 0 } ?: densityDpi
  )
}
