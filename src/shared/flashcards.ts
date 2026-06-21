export interface Flashcard {
  word: string;
  ipa: string;
  type: string;
  translations: Record<string, string>;
  example: string;
}

export const FLASHCARDS: Flashcard[] = [
  {
    word: "Serendipity",
    ipa: "/ˌserənˈdipədē/",
    type: "noun",
    translations: {
      vi: "Sự tình cờ may mắn",
      en: "Finding valuable things by chance",
      fr: "Heureux hasard, sérendipité",
      zh: "缘分，意外收获，机缘巧合",
      it: "Serendipità, felice scoperta casuale",
      ko: "뜻밖의 행운, 우연한 발견"
    },
    example: "We found the charming little restaurant by pure serendipity."
  },
  {
    word: "Eloquent",
    ipa: "/ˈeləkwənt/",
    type: "adjective",
    translations: {
      vi: "Hùng biện, lưu loát, có tài ăn nói",
      en: "Fluent or persuasive in speaking or writing",
      fr: "Éloquent, persuasif",
      zh: "雄辩的，口才流利的",
      it: "Eloquente, espressivo",
      ko: "유창한, 설득력 있는"
    },
    example: "His speech was eloquent and deeply moved the crowd."
  },
  {
    word: "Ephemeral",
    ipa: "/əˈfemərəl/",
    type: "adjective",
    translations: {
      vi: "Chóng tàn, phù du, ngắn ngủi",
      en: "Lasting for a very short time",
      fr: "Éphémère, passager",
      zh: "短暂的，朝生暮死的，转瞬即逝的",
      it: "Effimero, fugace",
      ko: "수명이 ngắn ngắn, 덧없는, 순식간의"
    },
    example: "Fame in the internet age is often ephemeral."
  },
  {
    word: "Mellifluous",
    ipa: "/meˈliflo͞oəs/",
    type: "adjective",
    translations: {
      vi: "Ngọt ngào, dịu ngọt (giọng nói, âm nhạc)",
      en: "Sweet or musical; pleasant to hear",
      fr: "Melliflu, doux, harmonieux",
      zh: "悦耳的，温柔流畅的",
      it: "Mellifluo, dolce come il miele",
      ko: "달콤한, 감미로운 (목소리/음악)"
    },
    example: "The singer had a mellifluous voice that captivated everyone."
  },
  {
    word: "Solitude",
    ipa: "/ˈsäləˌto͞od/",
    type: "noun",
    translations: {
      vi: "Sự biệt lập, trạng thái cô độc yên bình",
      en: "The state of being alone, usually peacefully",
      fr: "Solitude, isolement tranquille",
      zh: "孤独，独处，幽静",
      it: "Solitudine, isolamento pacifico",
      ko: "고독, 외로움 (대개 평화로운 상태)"
    },
    example: "He enjoyed the solitude of the forest."
  },
  {
    word: "Aesthetic",
    ipa: "/esˈTHedik/",
    type: "adjective",
    translations: {
      vi: "Thẩm mỹ, có tính nghệ thuật",
      en: "Concerned with beauty or the appreciation of beauty",
      fr: "Esthétique, artistique",
      zh: "美学的，审美的",
      it: "Estetico, artistico",
      ko: "미적인, 미학의"
    },
    example: "The new cafe has a very clean, minimalist aesthetic."
  },
  {
    word: "Resilience",
    ipa: "/rəˈzilyəns/",
    type: "noun",
    translations: {
      vi: "Khả năng phục hồi, kiên cường",
      en: "The capacity to recover quickly from difficulties",
      fr: "Résilience, capacité de récupération",
      zh: "韧性，恢复力，适应力",
      it: "Resilienza, capacità di ripresa",
      ko: "회복력, 탄성, 회복기능"
    },
    example: "The community showed amazing resilience after the storm."
  },
  {
    word: "Benevolent",
    ipa: "/bəˈnevələnt/",
    type: "adjective",
    translations: {
      vi: "Nhân từ, rộng lượng, từ thiện",
      en: "Well meaning and kindly",
      fr: "Bienveillant, charitable",
      zh: "仁慈的，慈善的，好意的",
      it: "Benevolo, caritatevole",
      ko: "자애로운, 친절한, 자선적인"
    },
    example: "A benevolent donor gifted computers to the school."
  },
  {
    word: "Ineffable",
    ipa: "/inˈefəb(əl)/",
    type: "adjective",
    translations: {
      vi: "Không tả xiết, không lời nào diễn tả được",
      en: "Too great or extreme to be expressed in words",
      fr: "Ineffable, indicible",
      zh: "言语无法表达的，妙不可言的",
      it: "Ineffabile, indicibile",
      ko: "말할 수 없는, 형언할 수 없는"
    },
    example: "The beauty of the mountain sunset was ineffable."
  },
  {
    word: "Luminous",
    ipa: "/ˈlo͞omənəs/",
    type: "adjective",
    translations: {
      vi: "Dạ quang, tỏa sáng, rõ ràng",
      en: "Full of or shedding light; bright or shining",
      fr: "Lumineux, brillant",
      zh: "发光的，明亮的，清楚 de",
      it: "Luminoso, splendente",
      ko: "어둠 속에서 빛나는, 야광의"
    },
    example: "The watch has luminous hands so you can read it in the dark."
  },
  {
    word: "Pensive",
    ipa: "/ˈpensiv/",
    type: "adjective",
    translations: {
      vi: "Trầm tư, suy nghĩ sâu sắc",
      en: "Engaged in, involving, or reflecting deep or serious thought",
      fr: "Pensif, songeur",
      zh: "沉思的，忧伤的",
      it: "Pensieroso, meditabondo",
      ko: "생각에 잠긴, 수심 어린"
    },
    example: "She stared out the window with a pensive expression."
  },
  {
    word: "Ubiquitous",
    ipa: "/yo͞oˈbikwədəs/",
    type: "adjective",
    translations: {
      vi: "Khắp mọi nơi, phổ biến rộng rãi",
      en: "Present, appearing, or found everywhere",
      fr: "Ubiquiste, omniprésent",
      zh: "无所不在的，普遍存在的",
      it: "Ubiquo, onnipresente",
      ko: "어디에나 있는, 아주 흔한"
    },
    example: "Smartphones have become ubiquitous in modern society."
  },
  {
    word: "Wanderlust",
    ipa: "/ˈwändərˌləst/",
    type: "noun",
    translations: {
      vi: "Sự thèm muốn đi du lịch, đam mê dịch chuyển",
      en: "A strong desire to travel",
      fr: "Envie de voyager",
      zh: "漫游欲，旅游热",
      it: "Desiderio di viaggiare, vagabondaggio",
      ko: "방랑벽, 여행열"
    },
    example: "Her wanderlust led her to visit over fifty countries."
  },
  {
    word: "Candid",
    ipa: "/ˈkandid/",
    type: "adjective",
    translations: {
      vi: "Thật thà, thẳng thắn, tự nhiên",
      en: "Truthful and straightforward; frank",
      fr: "Candide, franc, sincere",
      zh: "坦白直率的, 偷拍的",
      it: "Candido, schietto, sincero",
      ko: "솔직한, 숨김없는"
    },
    example: "Thank you for your candid feedback on my work."
  },
  {
    word: "Halcyon",
    ipa: "/ˈhalsēən/",
    type: "adjective",
    translations: {
      vi: "Thanh bình, êm ả, hạnh phúc",
      en: "Denoting a period of time in the past that was idyllically happy and peaceful",
      fr: "Halcyon, calme, paisible",
      zh: "宁静的，平稳的，幸福的美好时光",
      it: "Alcionio, tranquillo, sereno",
      ko: "평온한, 평화로운, 행복했던 옛 시절"
    },
    example: "She recalled the halcyon days of her childhood."
  }
];
