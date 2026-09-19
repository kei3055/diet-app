'use strict';

/*
 * data.js
 * ローカル食品データベース、レシピデータベース、活動量係数などの
 * アプリ全体で使用する静的データを定義する。
 */

// 活動量ごとの係数（TDEE計算に使用する）
const ACTIVITY_LEVELS = [
  { id: 'sedentary',   label: 'ほぼ運動しない',     factor: 1.2,   desc: 'デスクワーク中心でほとんど運動しない' },
  { id: 'light',       label: '軽い運動',           factor: 1.375, desc: '週1〜2回の軽い運動をする' },
  { id: 'moderate',    label: '普通',               factor: 1.55,  desc: '週3〜5回の運動をする' },
  { id: 'active',      label: '激しい運動',         factor: 1.725, desc: '週6〜7回の激しい運動をする' },
  { id: 'very_active', label: '非常に激しい運動',   factor: 1.9,   desc: '毎日の激しい運動や肉体労働がある' }
];

// 運動の種類ごとの METs（運動強度の目安）。消費カロリーの初期見積もりに使用する。
const EXERCISE_MET = {
  walking: 3.5,
  running: 8.0,
  cycling: 6.0,
  strength: 5.0,
  swimming: 6.0,
  other: 4.0
};

const EXERCISE_TYPE_LABELS = {
  walking: 'ウォーキング',
  running: 'ランニング',
  cycling: 'サイクリング',
  strength: '筋トレ',
  swimming: '水泳',
  other: 'その他'
};

// 食品データベース（100gあたりの栄養価。一般的な食品成分表の値を参考にした概算値）
const FOOD_DATABASE = [
  { id: 'rice_white',      name: '白米(ご飯)',        category: '主食',        unit: 100, kcal: 156, protein: 2.5,  fat: 0.3,  carbs: 37.1 },
  { id: 'rice_brown',      name: '玄米(ご飯)',        category: '主食',        unit: 100, kcal: 152, protein: 2.8,  fat: 1.0,  carbs: 35.6 },
  { id: 'chicken_breast',  name: '鶏胸肉(皮なし)',    category: '肉',          unit: 100, kcal: 108, protein: 22.3, fat: 1.5,  carbs: 0.0 },
  { id: 'chicken_thigh',   name: '鶏もも肉(皮つき)',  category: '肉',          unit: 100, kcal: 200, protein: 16.2, fat: 14.0, carbs: 0.0 },
  { id: 'pork',            name: '豚肉(もも赤身)',    category: '肉',          unit: 100, kcal: 183, protein: 20.5, fat: 10.2, carbs: 0.2 },
  { id: 'beef',            name: '牛肉(もも赤身)',    category: '肉',          unit: 100, kcal: 176, protein: 21.3, fat: 8.6,  carbs: 0.5 },
  { id: 'egg',             name: '卵',                category: '卵・乳製品', unit: 100, kcal: 151, protein: 12.3, fat: 10.3, carbs: 0.3 },
  { id: 'milk',            name: '牛乳',              category: '卵・乳製品', unit: 100, kcal: 61,  protein: 3.3,  fat: 3.8,  carbs: 4.8 },
  { id: 'yogurt',          name: 'ヨーグルト(無糖)',  category: '卵・乳製品', unit: 100, kcal: 62,  protein: 3.6,  fat: 3.0,  carbs: 4.9 },
  { id: 'natto',           name: '納豆',              category: '大豆製品',   unit: 100, kcal: 200, protein: 16.5, fat: 10.0, carbs: 12.1 },
  { id: 'tofu',            name: '豆腐(絹ごし)',      category: '大豆製品',   unit: 100, kcal: 56,  protein: 4.9,  fat: 3.0,  carbs: 2.0 },
  { id: 'bread',           name: '食パン',            category: '主食',        unit: 100, kcal: 264, protein: 9.3,  fat: 4.4,  carbs: 46.7 },
  { id: 'banana',          name: 'バナナ',            category: '果物',        unit: 100, kcal: 86,  protein: 1.1,  fat: 0.2,  carbs: 22.5 },
  { id: 'apple',           name: 'りんご',            category: '果物',        unit: 100, kcal: 57,  protein: 0.2,  fat: 0.1,  carbs: 15.5 },
  { id: 'cabbage',         name: 'キャベツ',          category: '野菜',        unit: 100, kcal: 23,  protein: 1.3,  fat: 0.2,  carbs: 5.2 },
  { id: 'onion',           name: '玉ねぎ',            category: '野菜',        unit: 100, kcal: 37,  protein: 1.0,  fat: 0.1,  carbs: 8.8 },
  { id: 'tomato',          name: 'トマト',            category: '野菜',        unit: 100, kcal: 20,  protein: 0.7,  fat: 0.1,  carbs: 4.7 },
  { id: 'broccoli',        name: 'ブロッコリー',      category: '野菜',        unit: 100, kcal: 33,  protein: 4.3,  fat: 0.5,  carbs: 5.2 },
  { id: 'potato',          name: 'じゃがいも',        category: '野菜',        unit: 100, kcal: 76,  protein: 1.6,  fat: 0.1,  carbs: 17.6 },
  { id: 'pasta',           name: 'パスタ(乾燥)',      category: '主食',        unit: 100, kcal: 378, protein: 12.9, fat: 1.8,  carbs: 73.1 },
  { id: 'oatmeal',         name: 'オートミール',      category: '主食',        unit: 100, kcal: 380, protein: 13.7, fat: 5.7,  carbs: 69.1 },
  { id: 'protein_powder',  name: 'プロテイン(ホエイ)', category: 'その他',      unit: 100, kcal: 400, protein: 80.0, fat: 6.0,  carbs: 8.0 }
];

// レシピデータベース（nutritionは1人前の想定値）
const RECIPE_DATABASE = [
  {
    id: 'r1', name: '鶏胸肉と卵の高たんぱく炒め', cookTime: 15,
    nutrition: { kcal: 350, protein: 35, fat: 12, carbs: 15 },
    ingredients: ['鶏胸肉(皮なし)', '卵', 'キャベツ', '玉ねぎ'],
    steps: ['鶏胸肉を一口大に切る', '卵を溶いておく', 'フライパンで鶏胸肉を炒める', 'キャベツと玉ねぎを加えてさらに炒める', '溶き卵を回し入れて仕上げる']
  },
  {
    id: 'r2', name: '豆腐と鶏そぼろのふわふわハンバーグ', cookTime: 25,
    nutrition: { kcal: 280, protein: 22, fat: 14, carbs: 18 },
    ingredients: ['豆腐(絹ごし)', '鶏もも肉(皮つき)', '玉ねぎ', '卵'],
    steps: ['豆腐の水気をしっかり切る', '玉ねぎをみじん切りにして炒める', '全ての材料をよく混ぜて成形する', 'フライパンで両面を焼く', '蓋をして中まで火を通す']
  },
  {
    id: 'r3', name: '鶏むね肉のサラダチキン風', cookTime: 20,
    nutrition: { kcal: 180, protein: 32, fat: 4, carbs: 2 },
    ingredients: ['鶏胸肉(皮なし)'],
    steps: ['鶏胸肉に塩を軽くすり込む', '耐熱袋に入れて空気を抜く', '沸騰したお湯に入れて火を止め15分置く', '粗熱を取ってスライスする']
  },
  {
    id: 'r4', name: '納豆卵かけご飯', cookTime: 5,
    nutrition: { kcal: 420, protein: 18, fat: 12, carbs: 58 },
    ingredients: ['白米(ご飯)', '納豆', '卵'],
    steps: ['ご飯を茶碗に盛る', '納豆をよく混ぜてタレを加える', '卵を割り入れる', 'ご飯にのせて完成']
  },
  {
    id: 'r5', name: '豚肉とブロッコリーの炒め物', cookTime: 15,
    nutrition: { kcal: 380, protein: 24, fat: 20, carbs: 22 },
    ingredients: ['豚肉(もも赤身)', 'ブロッコリー', '玉ねぎ'],
    steps: ['豚肉を一口大に切る', 'ブロッコリーを下茹でする', 'フライパンで豚肉を炒める', '野菜を加えて炒め合わせ、調味料で味を調える']
  },
  {
    id: 'r6', name: '牛肉とじゃがいもの煮物', cookTime: 30,
    nutrition: { kcal: 450, protein: 28, fat: 18, carbs: 40 },
    ingredients: ['牛肉(もも赤身)', 'じゃがいも', '玉ねぎ'],
    steps: ['牛肉と野菜を一口大に切る', '鍋で牛肉を軽く炒める', 'だし汁と調味料を加える', '野菜を加えて柔らかくなるまで煮込む']
  },
  {
    id: 'r7', name: 'オートミールバナナ粥', cookTime: 8,
    nutrition: { kcal: 320, protein: 10, fat: 6, carbs: 58 },
    ingredients: ['オートミール', 'バナナ', '牛乳'],
    steps: ['耐熱容器にオートミールと牛乳を入れる', '電子レンジで1〜2分加熱する', 'スライスしたバナナをのせる']
  },
  {
    id: 'r8', name: 'ヨーグルトバナナのプロテインボウル', cookTime: 5,
    nutrition: { kcal: 300, protein: 25, fat: 5, carbs: 40 },
    ingredients: ['ヨーグルト(無糖)', 'バナナ', 'プロテイン(ホエイ)'],
    steps: ['ヨーグルトにプロテインパウダーを混ぜる', 'スライスしたバナナをのせる']
  },
  {
    id: 'r9', name: '鶏もも肉のトマト煮込み', cookTime: 25,
    nutrition: { kcal: 400, protein: 30, fat: 20, carbs: 15 },
    ingredients: ['鶏もも肉(皮つき)', 'トマト', '玉ねぎ'],
    steps: ['鶏もも肉を一口大に切って焼き色をつける', '玉ねぎを炒める', 'トマトを加えて煮込む', '塩コショウで味を調える']
  },
  {
    id: 'r10', name: '豆腐と卵のふんわりスープ', cookTime: 10,
    nutrition: { kcal: 150, protein: 12, fat: 8, carbs: 6 },
    ingredients: ['豆腐(絹ごし)', '卵', '玉ねぎ'],
    steps: ['だし汁に玉ねぎを入れて煮る', '豆腐を加える', '溶き卵を回し入れて完成']
  },
  {
    id: 'r11', name: 'ブロッコリーと鶏胸肉のパスタ', cookTime: 20,
    nutrition: { kcal: 520, protein: 38, fat: 10, carbs: 65 },
    ingredients: ['パスタ(乾燥)', '鶏胸肉(皮なし)', 'ブロッコリー'],
    steps: ['パスタを茹でる', '鶏胸肉を一口大に切って炒める', 'ブロッコリーを加える', '茹でたパスタと絡めて味を調える']
  },
  {
    id: 'r12', name: '玄米と鶏もも肉の丼', cookTime: 20,
    nutrition: { kcal: 550, protein: 30, fat: 18, carbs: 60 },
    ingredients: ['玄米(ご飯)', '鶏もも肉(皮つき)', '玉ねぎ', '卵'],
    steps: ['鶏もも肉と玉ねぎを甘辛いタレで煮る', '溶き卵でとじる', '玄米ご飯にのせる']
  },
  {
    id: 'r13', name: 'プロテインパンケーキ', cookTime: 15,
    nutrition: { kcal: 320, protein: 28, fat: 8, carbs: 35 },
    ingredients: ['プロテイン(ホエイ)', '卵', '牛乳'],
    steps: ['材料を全てボウルでよく混ぜる', 'フライパンで弱火で両面を焼く']
  },
  {
    id: 'r14', name: 'じゃがいもと豚肉のカレー風炒め', cookTime: 20,
    nutrition: { kcal: 480, protein: 22, fat: 22, carbs: 48 },
    ingredients: ['じゃがいも', '豚肉(もも赤身)', '玉ねぎ'],
    steps: ['じゃがいもを一口大に切り下茹でする', '豚肉と玉ねぎを炒める', 'カレー粉と調味料を加えて炒め合わせる']
  },
  {
    id: 'r15', name: 'りんごとヨーグルトのデザート', cookTime: 5,
    nutrition: { kcal: 150, protein: 5, fat: 3, carbs: 28 },
    ingredients: ['りんご', 'ヨーグルト(無糖)'],
    steps: ['りんごを一口大に切る', 'ヨーグルトと和えて完成']
  },
  {
    id: 'r16', name: 'キャベツと豚肉のミルフィーユ蒸し', cookTime: 25,
    nutrition: { kcal: 320, protein: 24, fat: 18, carbs: 10 },
    ingredients: ['キャベツ', '豚肉(もも赤身)'],
    steps: ['キャベツと豚肉を交互に重ねる', '蒸し器または電子レンジで加熱する', 'ポン酢などで味付けする']
  },
  {
    id: 'r17', name: '牛肉とブロッコリーの炒め物', cookTime: 15,
    nutrition: { kcal: 380, protein: 30, fat: 22, carbs: 10 },
    ingredients: ['牛肉(もも赤身)', 'ブロッコリー'],
    steps: ['牛肉を炒める', '下茹でしたブロッコリーを加える', 'オイスターソースなどで味付けする']
  },
  {
    id: 'r18', name: 'トマトと卵の中華炒め', cookTime: 10,
    nutrition: { kcal: 220, protein: 12, fat: 14, carbs: 10 },
    ingredients: ['トマト', '卵'],
    steps: ['卵を溶いて炒め、一度取り出す', 'トマトを炒める', '卵を戻し入れて混ぜ合わせる']
  }
];

// PFCの初期比率（ダイエット向けの一般的な設定）。単位は%。
const DEFAULT_PFC_RATIO = { protein: 30, fat: 25, carbs: 45 };

// 安全のための1日あたり最低摂取カロリー(kcal)。これを下回る目標は設定しない。
const MIN_CALORIES = { male: 1500, female: 1200, other: 1350 };
