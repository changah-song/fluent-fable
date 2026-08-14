package expo.modules.screenocr

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.SystemClock
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognizer
import expo.modules.screenocroverlay.OcrBoxRefiner
import expo.modules.screenocroverlay.OcrRecognizers
import expo.modules.screenocroverlay.OcrSerializer
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ScreenOcrModule : Module() {
  // One recognizer per script ("ko" | "zh"); the correct model is chosen from the
  // target language the JS layer passes in (which mirrors the Profile page).
  private val recognizers = mutableMapOf<String, TextRecognizer>()

  override fun definition() = ModuleDefinition {
    Name("ScreenOcr")

    OnDestroy {
      recognizers.values.forEach { it.close() }
      recognizers.clear()
    }

    AsyncFunction("recognizeImage") { uriString: String, language: String? ->
      if (uriString.isBlank()) {
        throw IllegalArgumentException("Image uri is required")
      }

      val totalStartNs = SystemClock.elapsedRealtimeNanos()
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val uri = Uri.parse(uriString)
      val image = InputImage.fromFilePath(context, uri)
      val dimensions = resolveImageDimensions(context, uri, image.width, image.height)
      val decodeEndNs = SystemClock.elapsedRealtimeNanos()
      val currentRecognizer = getRecognizer(language)

      val recognizeStartNs = SystemClock.elapsedRealtimeNanos()
      val result = Tasks.await(currentRecognizer.process(image))
      val recognizeEndNs = SystemClock.elapsedRealtimeNanos()
      val serializeStartNs = SystemClock.elapsedRealtimeNanos()

      val serialized = OcrSerializer.serialize(
        result = result,
        imageWidth = dimensions.first,
        imageHeight = dimensions.second,
        language = language,
        filterTopChrome = false,
        includeText = true,
        includeBlocks = true,
        includeDebugBoxes = false
      )
      val refineStartNs = SystemClock.elapsedRealtimeNanos()
      val refinedSerialized = decodeBitmapForRefinement(context, uri, dimensions.first, dimensions.second)?.let { bitmap ->
        try {
          OcrBoxRefiner.refine(serialized, bitmap)
        } finally {
          bitmap.recycle()
        }
      } ?: serialized
      val refineEndNs = SystemClock.elapsedRealtimeNanos()

      refinedSerialized.result + mapOf(
        "timing" to mapOf(
          "decodeMs" to elapsedMs(totalStartNs, decodeEndNs),
          "recognizeMs" to elapsedMs(recognizeStartNs, recognizeEndNs),
          "serializeMs" to elapsedMs(serializeStartNs, refineStartNs),
          "refineMs" to elapsedMs(refineStartNs, refineEndNs),
          "totalMs" to elapsedMs(totalStartNs, refineEndNs),
          "targetCount" to refinedSerialized.targets.size,
          "imageWidth" to dimensions.first,
          "imageHeight" to dimensions.second
        )
      )
    }
  }

  private fun getRecognizer(language: String?): TextRecognizer {
    val key = OcrRecognizers.normalizeLanguage(language)
    return recognizers.getOrPut(key) { OcrRecognizers.create(key) }
  }
}

private fun decodeBitmapForRefinement(
  context: Context,
  uri: Uri,
  expectedWidth: Int,
  expectedHeight: Int
): Bitmap? {
  if (expectedWidth <= 0 || expectedHeight <= 0) {
    return null
  }

  return try {
    context.contentResolver.openInputStream(uri)?.use { stream ->
      val bitmap = BitmapFactory.decodeStream(stream) ?: return@use null
      if (bitmap.width == expectedWidth && bitmap.height == expectedHeight) {
        bitmap
      } else {
        bitmap.recycle()
        null
      }
    }
  } catch (_: Exception) {
    null
  }
}

private fun elapsedMs(startNs: Long, endNs: Long): Double =
  (endNs - startNs).coerceAtLeast(0L).toDouble() / 1_000_000.0

private fun resolveImageDimensions(
  context: Context,
  uri: Uri,
  fallbackWidth: Int,
  fallbackHeight: Int
): Pair<Int, Int> {
  if (fallbackWidth > 0 && fallbackHeight > 0) {
    return Pair(fallbackWidth, fallbackHeight)
  }

  return try {
    context.contentResolver.openInputStream(uri)?.use { stream ->
      val options = BitmapFactory.Options().apply {
        inJustDecodeBounds = true
      }

      BitmapFactory.decodeStream(stream, null, options)
      Pair(options.outWidth.takeIf { it > 0 } ?: fallbackWidth, options.outHeight.takeIf { it > 0 } ?: fallbackHeight)
    } ?: Pair(fallbackWidth, fallbackHeight)
  } catch (_: Exception) {
    Pair(fallbackWidth, fallbackHeight)
  }
}
