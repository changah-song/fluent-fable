import React, { useState } from 'react';
import { Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import Translator from 'react-native-translator';

import axios from 'axios';

// Top section component
const TopSection = ({ highlightedWord }) => {
  const [translatedText, setTranslatedText] = useState("");

  return (
    <View style={styles.topSection}>
      <Text style={{ fontSize: 17 }}>
        {highlightedWord}
      </Text>
      <Translator 
        from="ko"
        to="en"
        value={highlightedWord}
        onTranslated={(t) => setTranslatedText(t)}  
      />
      <Text>{translatedText}</Text>
    </View>
  );
};

const LightUpText = () => {
  const [highlightedWord, setHighlightedWord] = useState(null);
  const text = "6일 인스타그램과 엑스(X·옛 트위터) 등 사회관계망서비스(SNS)에는 전날부터 다양한 투표 인증 사진이 올라왔다. 이 중 젊은 세대의 눈길을 사로잡은 것은 손바닥만 한 크기의 종이를 들고 찍은 인증 사진이다. 이는 유권자가 투표소로 향하기 전 직접 챙겨간 인증 용지다. 손등에 도장을 남기던 방식에서 벗어나 투표 인증을 위한 이미지를 만든 것이다. 인증 용지에 등장하는 이미지는 만화 캐릭터, 이모티콘 캐릭터, 프로야구팀 등 다양하다. 자신의 관심 분야에 맞춰 직접 용지를 만들거나 SNS에 무료 배포된 이미지를 출력해 사용한다. 아이돌 팬들은 최애 멤버의 포토카드를 활용하기도 한다. 인증 방법은 정해져 있다. 그림 속 비워진 공간이나 글자에 기표 도장을 찍어 이미지를 완성시키면 된다.";

  const handleWordPress = (word) => {
    setHighlightedWord(word);
  };

  // const text = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";
  
  const words = text.match(/[\p{Script=Hangul}]+|[a-zA-Z]+|[^\p{Script=Hangul}\w]|[\d]+/gu);

  return (
    <View style={styles.container}>
      <TopSection highlightedWord={highlightedWord} />
      <Text style={styles.text}>
        {words.map((word, index) => {
          // Only consider alphanumeric characters for highlighting
          const strippedWord = word.match(/[\p{L}\p{N}]+/gu) ? word : null;
          return (
            <Text key={index} onPress={() => strippedWord && handleWordPress(strippedWord)} style={highlightedWord === strippedWord ? styles.highlighted : null}>
              {word}{''}
            </Text>
          );
        })}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: '10%',  // leave space for the top section
  },
  topSection: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '15%',
    justifyContent: 'center',
    alignItems: 'left',
    padding: '3%',
    backgroundColor: '#e0e0e0',
    width: '120%',
  },
  text: {
    fontSize: 18,
    textAlign: 'center',
    lineHeight: 30,
  },
  highlighted: {
    backgroundColor: 'yellow',
  },
});

export default LightUpText;