import React from 'react';
import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

const BottomSection = ({ setHighlightedWord }) => {
    const text = "6일 인스타그램과 엑스(X·옛 트위터) 등 사회관계망서비스(SNS)에는 전날부터 다양한 투표 인증 사진이 올라왔다. 이 중 젊은 세대의 눈길을 사로잡은 것은 손바닥만 한 크기의 종이를 들고 찍은 인증 사진이다. 이는 유권자가 투표소로 향하기 전 직접 챙겨간 인증 용지다. 손등에 도장을 남기던 방식에서 벗어나 투표 인증을 위한 이미지를 만든 것이다. 인증 용지에 등장하는 이미지는 만화 캐릭터, 이모티콘 캐릭터, 프로야구팀 등 다양하다. 자신의 관심 분야에 맞춰 직접 용지를 만들거나 SNS에 무료 배포된 이미지를 출력해 사용한다. 아이돌 팬들은 최애 멤버의 포토카드를 활용하기도 한다. 인증 방법은 정해져 있다. 그림 속 비워진 공간이나 글자에 기표 도장을 찍어 이미지를 완성시키면 된다.";
    const [pressedWord, setPressedWord] = useState("");

    const handleWordPress = (word) => {
      setHighlightedWord(word);
      setPressedWord(word);
    };
  
    const words = text.match(/[\p{Script=Hangul}]+|[a-zA-Z]+|[^\p{Script=Hangul}\w]|[\d]+/gu);
  
    return (
      <View style={styles.bottomSection}>
        <Text style={styles.text}>
          {words.map((word, index) => {
            const strippedWord = word.match(/[\p{L}\p{N}]+/gu) ? word : null;
            return (
              <TouchableOpacity key={index} onPress={() => strippedWord && handleWordPress(strippedWord)} style={pressedWord === strippedWord ? styles.highlighted : null}>
                <Text style={styles.text}>{word}{''}</Text>
              </TouchableOpacity>
            );
          })}
        </Text>
      </View>
    );
  };

const styles = StyleSheet.create({
  bottomSection: {
    position: 'absolute',
    bottom: 0,
    height: '90%',
    justifyContent: 'center',
    alignItems: 'left',
    padding: '10%',
    width: '120%',
  },
  text: {
    fontSize: 18,
    textAlign: 'center',
    lineHeight: 30,
  },
  highlighted: {
    backgroundColor: '#D5DEE0',
  },
});

export default BottomSection;