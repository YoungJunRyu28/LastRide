/**
 * Kana reading → station-sign style romaji ("しぶや" → "Shibuya",
 * "とうきょう" → "Tokyo", "しんばし" → "Shimbashi", "おおつか" → "Otsuka"). Station search
 * (odptStations.ts) uses this to match a kana query against English station names.
 */

const DIGRAPHS: Record<string, string> = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo", しゃ: "sha", しゅ: "shu", しょ: "sho", ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo", ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo", みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo", ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo", じゃ: "ja", じゅ: "ju", じょ: "jo",
  びゃ: "bya", びゅ: "byu", びょ: "byo", ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo", ぢゃ: "ja", ぢゅ: "ju", ぢょ: "jo",
};

const MONOGRAPHS: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o", か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so", た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no", は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo", や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro", わ: "wa", を: "o", ん: "n",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go", ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do", ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po", ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o", ゔ: "vu",
};

function toHiragana(text: string) {
  // Katakana block is offset 0x60 from hiragana.
  return text.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

export function kanaToRomaji(reading: string): string {
  const kana = toHiragana(reading.trim());
  let out = "";
  for (let index = 0; index < kana.length; index += 1) {
    const pair = kana.slice(index, index + 2);
    const char = kana[index];
    if (DIGRAPHS[pair]) {
      out += DIGRAPHS[pair];
      index += 1;
    } else if (char === "っ") {
      // Doubles the next consonant: "っぽ" → "ppo", "っち" → "tchi".
      const next = DIGRAPHS[kana.slice(index + 1, index + 3)] ?? MONOGRAPHS[kana[index + 1] ?? ""] ?? "";
      out += next.startsWith("ch") ? "t" : (next[0] ?? "");
    } else if (char === "ー") {
      // Long-vowel mark: station signs drop it.
    } else if (MONOGRAPHS[char] !== undefined) {
      out += MONOGRAPHS[char];
    } else {
      out += char; // spaces, digits, Latin letters pass through
    }
  }
  const signStyle = out
    .replace(/n(?=[bmp])/g, "m") // しんばし → shimbashi
    .replace(/ou/g, "o") // とうきょう → tokyo
    .replace(/oo/g, "o") // おおさか → osaka
    .replace(/uu/g, "u");
  return signStyle.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}
