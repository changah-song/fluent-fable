import { useState } from 'react';
import { Alert, View, Text, SafeAreaView, TouchableOpacity } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

import { Reader, ReaderProvider } from '@epubjs-react-native/core';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';

const Epub = () => {
    const [src, setSrc] = useState(null);

    return (
        <SafeAreaView style={{ flex: 1 }}>
            
            <View>
                <TouchableOpacity onPress={() => setSrc("https://s3.amazonaws.com/moby-dick/OPS/package.opf")}>
                    <Text>Book (.opf)</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setSrc(epub)}>
                    <Text>Book (.epub)</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setSrc(base64)}>
                    <Text>Book (base64)</Text>
                </TouchableOpacity>

                <TouchableOpacity
                onPress={() => {
                    Alert.alert(
                    'Instructions',
                    'To make this work copy the books (.epub) located on your computer and paste in the emulator',
                    [
                        {
                        text: 'Ok',
                        onPress: async () => {
                            const { assets } = await DocumentPicker.getDocumentAsync({
                                copyToCacheDirectory: true,
                            });
                            if (!assets) return;

                            const { uri } = assets[0];

                            if (uri) setSrc(uri);
                            console.log(uri);
                        },
                        },
                    ]
                    );
                }}
                >
                <Text>Book (local)</Text>
                </TouchableOpacity>
            </View>
            <ReaderProvider>
                <Reader
                    src={src}
                    fileSystem={useFileSystem}
                    enableSelection={true}
                    onSelected={(text) => { console.log(text) }}
                    menuItems={[]}
                />
            </ReaderProvider>

        </SafeAreaView>
    );
}

export default Epub;
