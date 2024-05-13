import * as React from 'react';
import { View, Text, SafeAreaView } from 'react-native';
import { Reader, useReader } from '@epubjs-react-native/core';
import { useFileSystem } from '@epubjs-react-native/expo-file-system'; // for Expo project

const Epub = () => {
    const { goToLocation } = useReader();

    return (
        <SafeAreaView style={{ flex: 1 }}>
            <Reader
                enableSelection={true}
                src="https://s3.amazonaws.com/moby-dick/OPS/package.opf"
                fileSystem={useFileSystem}
            />
        </SafeAreaView>
    );
}

export default Epub