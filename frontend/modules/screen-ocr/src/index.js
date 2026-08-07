import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { translate } from '../../../i18n/translations';
import { getRuntimeInterfaceLanguage, getRuntimeTargetLanguage } from '../../../services/interfaceLanguage';

const NativeScreenOcr = Platform.OS === 'android'
    ? requireNativeModule('ScreenOcr')
    : null;

// The target language (same one shown on the Profile page) selects the ML Kit
// script recognizer, so a Chinese book is read with the Chinese model, not Korean.
export const recognizeImage = (uri, language = getRuntimeTargetLanguage()) => {
    if (!NativeScreenOcr) {
        return Promise.reject(new Error(
            translate(getRuntimeInterfaceLanguage(), 'ocr.screenshotAndroidOnly')
        ));
    }

    return NativeScreenOcr.recognizeImage(uri, language);
};

export default {
    recognizeImage,
};
