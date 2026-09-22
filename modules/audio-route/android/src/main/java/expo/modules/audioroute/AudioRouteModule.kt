package expo.modules.audioroute

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * SikaVoice audio-route probe.
 *
 * The brief requires that spoken transaction amounts never leave the phone's
 * loudspeaker in public: when a private route (wired headset, earbuds,
 * Bluetooth, USB or a hearing aid) is available the app may speak aloud,
 * otherwise it falls back to haptics.
 *
 * Expo SDK 57 exposes no output-route API, and the previous implementation
 * guessed at a `ReactNativeNativeAudioDeviceModule` that does not exist - so
 * it always answered "no headphones" and silently forced every screen into
 * haptics-only mode. This module answers the question for real through
 * AudioManager, which is the only supported source of truth on Android.
 */
class AudioRouteModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private var registered = false

  private val deviceCallback = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) = emit()
    override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) = emit()
  }

  private val audioManager: AudioManager?
    get() = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("AudioRoute")

    Events("onAudioRouteChanged")

    Function("getOutputRoute") {
      describeRoute()
    }

    OnStartObserving("onAudioRouteChanged") {
      register()
    }

    OnStopObserving("onAudioRouteChanged") {
      unregister()
    }

    OnDestroy {
      unregister()
    }
  }

  private fun register() {
    if (registered) return
    val manager = audioManager ?: return
    // Callbacks must be registered on a thread with a Looper; the module
    // definition runs on the JS thread, so hop to the main looper.
    handler.post {
      if (registered) return@post
      manager.registerAudioDeviceCallback(deviceCallback, handler)
      registered = true
    }
  }

  private fun unregister() {
    if (!registered) return
    audioManager?.unregisterAudioDeviceCallback(deviceCallback)
    registered = false
  }

  private fun emit() {
    val snapshot = describeRoute()
    sendEvent("onAudioRouteChanged", snapshot)
  }

  /**
   * @return a snapshot of the current output devices, where `private` is true
   *   when at least one private (non-loudspeaker) output is available.
   */
  private fun describeRoute(): Map<String, Any> {
    val manager = audioManager
      ?: return mapOf(
        "private" to false,
        "active" to emptyList<String>(),
        "available" to emptyList<String>(),
        "reason" to "no_audio_service"
      )

    val types = try {
      manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).map { it.type }
    } catch (error: Throwable) {
      return mapOf(
        "private" to false,
        "active" to emptyList<String>(),
        "available" to emptyList<String>(),
        "reason" to "probe_failed"
      )
    }

    val privateTypes = types.filter { PRIVATE_OUTPUT_TYPES.contains(it) }

    return mapOf(
      "private" to privateTypes.isNotEmpty(),
      "active" to privateTypes.map { typeName(it) },
      "available" to types.map { typeName(it) },
      "reason" to if (privateTypes.isEmpty()) "speaker_only" else "private_route_available"
    )
  }

  private fun typeName(type: Int): String = when (type) {
    AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired_headset"
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "wired_headphones"
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "bluetooth_a2dp"
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth_sco"
    AudioDeviceInfo.TYPE_USB_HEADSET -> "usb_headset"
    AudioDeviceInfo.TYPE_USB_DEVICE -> "usb_device"
    AudioDeviceInfo.TYPE_HEARING_AID -> "hearing_aid"
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "builtin_speaker"
    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "builtin_earpiece"
    AudioDeviceInfo.TYPE_BUILTIN_MIC -> "builtin_mic"
    AudioDeviceInfo.TYPE_TELEPHONY -> "telephony"
    AudioDeviceInfo.TYPE_FM_TUNER -> "fm_tuner"
    AudioDeviceInfo.TYPE_LINE_ANALOG -> "line_analog"
    AudioDeviceInfo.TYPE_LINE_DIGITAL -> "line_digital"
    AudioDeviceInfo.TYPE_HDMI -> "hdmi"
    AudioDeviceInfo.TYPE_IP -> "ip"
    AudioDeviceInfo.TYPE_BUS -> "bus"
    AudioDeviceInfo.TYPE_REMOTE_SUBMIX -> "remote_submix"
    AudioDeviceInfo.TYPE_DOCK -> "dock"
    else -> "other_$type"
  }

  private companion object {
    /**
     * Output routes that keep audio private to the listener. Built-in
     * loudspeakers, earpieces and docks are deliberately excluded.
     */
    val PRIVATE_OUTPUT_TYPES: Set<Int> = setOf(
      AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
      AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
      AudioDeviceInfo.TYPE_USB_HEADSET,
      AudioDeviceInfo.TYPE_HEARING_AID,
      @Suppress("InlinedApi")
      AudioDeviceInfo.TYPE_BLE_HEADSET
    )
  }
}
