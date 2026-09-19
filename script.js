'use strict';

/*
 * script.js
 * ダイエット管理アプリのメインロジック。
 * 役割ごとに以下のセクションに分けている。
 *   1. ストレージ / 日付ユーティリティ
 *   2. 計算処理（BMR / TDEE / 目標カロリー / PFC）
 *   3. プロフィール管理
 *   4. 食事記録データ管理
 *   5. 体重記録データ管理
 *   6. 運動記録データ管理
 *   7. 手持ち食材データ管理
 *   8. レシピ検索・おすすめ計算
 *   9. アドバイス生成
 *  10. 画面描画（UI）
 *  11. モーダル
 *  12. データエクスポート/インポート/削除
 *  13. 画面遷移・イベント登録・初期化
 */

// ============================================================
// 1. ストレージ / 日付ユーティリティ
// ============================================================

const STORAGE_KEYS = {
  PROFILE: 'dietapp_profile',
  MEALS: 'dietapp_meals',
  WEIGHTS: 'dietapp_weights',
  EXERCISES: 'dietapp_exercises',
  INGREDIENTS: 'dietapp_ingredients',
  INITIALIZED: 'dietapp_initialized'
};

const state = {
  profile: null,
  currentDate: null,
  currentScreen: 'home',
  weightChartRange: '7',
  analysisRange: '7',
  recipeSort: 'match',
  pendingMealType: null,
  weightChart: null,
  analysisCharts: {}
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error('データ読み込みエラー:', key, e);
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('データ保存エラー:', key, e);
    showToast('データの保存に失敗しました。ストレージ容量をご確認ください。', 'error');
  }
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDateLabel(str) {
  const date = parseDate(str);
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${date.getMonth() + 1}月${date.getDate()}日(${days[date.getDay()]})`;
}

function formatDateShort(str) {
  const d = parseDate(str);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function addDays(str, n) {
  const d = parseDate(str);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

function todayStr() {
  return formatDate(new Date());
}

function roundTo1(v) {
  return Math.round(v * 10) / 10;
}

function clampPct(v) {
  if (isNaN(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

// ============================================================
// 2. 計算処理
// ============================================================

// 基礎代謝量(BMR)を Mifflin-St Jeor式 で計算する
//   男性: 10×体重(kg) + 6.25×身長(cm) - 5×年齢 + 5
//   女性: 10×体重(kg) + 6.25×身長(cm) - 5×年齢 - 161
//   その他: 男女の中間値を採用（簡易対応）
function calcBMR(weight, height, age, gender) {
  const base = 10 * weight + 6.25 * height - 5 * age;
  if (gender === 'male') return base + 5;
  if (gender === 'female') return base - 161;
  return base - 78;
}

// BMI = 体重(kg) ÷ 身長(m)の2乗
function calcBMI(weight, height) {
  const h = height / 100;
  if (h <= 0) return 0;
  return weight / (h * h);
}

function getActivityFactor(activityId) {
  const level = ACTIVITY_LEVELS.find(a => a.id === activityId);
  return level ? level.factor : 1.375;
}

// TDEE(推定消費カロリー) = 基礎代謝量 × 活動量係数
function calcTDEE(bmr, activityId) {
  return bmr * getActivityFactor(activityId);
}

// 目標摂取カロリーを計算する。
// 体重差(kg) × 7700kcal（体脂肪1kgあたりの概算エネルギー量）を
// 目標達成期間(日数)で割り、1日あたりの調整カロリーとしてTDEEから増減させる。
// 安全のため、性別ごとの最低カロリーを下回らないようにし、
// 上限もTDEEの1.3倍程度に収める（極端な設定を防止する）。
function calcTargetCalories(profile) {
  const bmr = calcBMR(profile.currentWeight, profile.height, profile.age, profile.gender);
  const tdee = calcTDEE(bmr, profile.activity);
  const weightDiff = profile.currentWeight - profile.targetWeight; // 正:減量 / 負:増量
  const totalEnergy = weightDiff * 7700;
  const days = Math.max(profile.periodWeeks * 7, 7);
  const dailyAdjustment = totalEnergy / days;

  let target = tdee - dailyAdjustment;

  const minCal = MIN_CALORIES[profile.gender] || MIN_CALORIES.other;
  if (target < minCal) target = minCal;
  const maxCal = tdee * 1.3;
  if (target > maxCal) target = maxCal;

  return { bmr, tdee, target: Math.round(target) };
}

// PFC目標グラム数を計算する。
// たんぱく質:4kcal/g、脂質:9kcal/g、炭水化物:4kcal/g として、
// 目標カロリーにPFC比率(%)を掛けてグラム数に変換する。
function calcPfcTargets(targetCalories, pfcRatio) {
  const proteinCal = targetCalories * (pfcRatio.protein / 100);
  const fatCal = targetCalories * (pfcRatio.fat / 100);
  const carbsCal = targetCalories * (pfcRatio.carbs / 100);
  return {
    protein: Math.round(proteinCal / 4),
    fat: Math.round(fatCal / 9),
    carbs: Math.round(carbsCal / 4)
  };
}

function getEffectiveProfile() {
  return { ...state.profile, currentWeight: getLatestWeight() };
}

function getDailyTargets() {
  const profile = getEffectiveProfile();
  const { target } = calcTargetCalories(profile);
  const pfc = calcPfcTargets(target, profile.pfcRatio);
  return { calories: target, ...pfc };
}

// ============================================================
// 3. プロフィール管理
// ============================================================

function saveProfile(profileData) {
  state.profile = profileData;
  saveJSON(STORAGE_KEYS.PROFILE, profileData);
}

function handleOnboardingSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const age = Number(form.age.value);
  const gender = form.gender.value;
  const height = Number(form.height.value);
  const currentWeight = Number(form.currentWeight.value);
  const targetWeight = Number(form.targetWeight.value);
  const periodWeeks = Number(form.periodWeeks.value);
  const activity = form.activity.value;

  if (!age || age <= 0 || !height || height <= 0 || !currentWeight || currentWeight <= 0 ||
      !targetWeight || targetWeight <= 0 || !periodWeeks || periodWeeks <= 0) {
    showToast('すべての項目を正しく入力してください', 'error');
    return;
  }

  const profile = {
    age, gender, height, currentWeight, targetWeight, periodWeeks, activity,
    startWeight: currentWeight,
    pfcRatio: { ...DEFAULT_PFC_RATIO },
    createdAt: new Date().toISOString()
  };
  saveProfile(profile);
  addWeightRecord({ date: todayStr(), weight: currentWeight, bodyFat: null, memo: '初回登録' });
  localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');

  document.getElementById('screen-onboarding').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');

  bindEvents();
  state.currentDate = todayStr();
  showScreen('home');
  showToast('プロフィールを登録しました！', 'success');
}

function handleSettingsSubmit(e) {
  e.preventDefault();
  const p = Number(document.getElementById('settingsProteinRatio').value);
  const f = Number(document.getElementById('settingsFatRatio').value);
  const c = Number(document.getElementById('settingsCarbsRatio').value);
  if (p + f + c !== 100) {
    showToast('PFCの比率合計は100%にしてください', 'error');
    return;
  }
  const age = Number(document.getElementById('settingsAge').value);
  const height = Number(document.getElementById('settingsHeight').value);
  const targetWeight = Number(document.getElementById('settingsTargetWeight').value);
  const periodWeeks = Number(document.getElementById('settingsPeriod').value);
  if (!age || age <= 0 || !height || height <= 0 || !targetWeight || targetWeight <= 0 || !periodWeeks || periodWeeks <= 0) {
    showToast('数値項目を正しく入力してください', 'error');
    return;
  }

  const updated = {
    ...state.profile,
    age, height, targetWeight, periodWeeks,
    gender: document.getElementById('settingsGender').value,
    activity: document.getElementById('settingsActivity').value,
    pfcRatio: { protein: p, fat: f, carbs: c }
  };
  saveProfile(updated);
  showToast('設定を保存しました', 'success');
  renderAll();
}

// ============================================================
// 4. 食事記録データ管理
// ============================================================

function getMealsData() {
  return loadJSON(STORAGE_KEYS.MEALS, {});
}

function getMealsForDate(dateStr) {
  const all = getMealsData();
  return all[dateStr] || { breakfast: [], lunch: [], dinner: [], snack: [] };
}

function saveMealsForDate(dateStr, dayMeals) {
  const all = getMealsData();
  all[dateStr] = dayMeals;
  saveJSON(STORAGE_KEYS.MEALS, all);
}

function addFoodEntry(dateStr, mealType, entry) {
  const dayMeals = getMealsForDate(dateStr);
  entry.id = 'food_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  dayMeals[mealType].push(entry);
  saveMealsForDate(dateStr, dayMeals);
}

function updateFoodEntry(dateStr, mealType, entryId, updates) {
  const dayMeals = getMealsForDate(dateStr);
  const idx = dayMeals[mealType].findIndex(f => f.id === entryId);
  if (idx !== -1) {
    dayMeals[mealType][idx] = { ...dayMeals[mealType][idx], ...updates, id: entryId };
    saveMealsForDate(dateStr, dayMeals);
  }
}

function deleteFoodEntry(dateStr, mealType, entryId) {
  const dayMeals = getMealsForDate(dateStr);
  dayMeals[mealType] = dayMeals[mealType].filter(f => f.id !== entryId);
  saveMealsForDate(dateStr, dayMeals);
}

function calcDayTotals(dayMeals) {
  const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  ['breakfast', 'lunch', 'dinner', 'snack'].forEach(mealType => {
    (dayMeals[mealType] || []).forEach(f => {
      totals.kcal += f.kcal;
      totals.protein += f.protein;
      totals.fat += f.fat;
      totals.carbs += f.carbs;
    });
  });
  return totals;
}

// 食品(100gあたりの値)と量(g)から実際の記録エントリを作成する
function buildFoodEntry(food, amount) {
  const ratio = amount / (food.unit || 100);
  return {
    foodId: food.id,
    name: food.name,
    amount,
    kcal: roundTo1(food.kcal * ratio),
    protein: roundTo1(food.protein * ratio),
    fat: roundTo1(food.fat * ratio),
    carbs: roundTo1(food.carbs * ratio)
  };
}

function getRemainingNutrients(dateStr) {
  const dayMeals = getMealsForDate(dateStr);
  const consumed = calcDayTotals(dayMeals);
  const targets = getDailyTargets();
  return {
    kcal: targets.calories - consumed.kcal,
    protein: targets.protein - consumed.protein,
    fat: targets.fat - consumed.fat,
    carbs: targets.carbs - consumed.carbs,
    consumed, targets
  };
}

// ============================================================
// 5. 体重記録データ管理
// ============================================================

function getWeights() {
  return loadJSON(STORAGE_KEYS.WEIGHTS, []);
}

function saveWeights(list) {
  saveJSON(STORAGE_KEYS.WEIGHTS, list);
}

function addWeightRecord(record) {
  const list = getWeights();
  const idx = list.findIndex(w => w.date === record.date);
  record.id = idx !== -1 ? list[idx].id : 'w_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  if (idx !== -1) list[idx] = record; else list.push(record);
  saveWeights(list);
}

function deleteWeightRecord(id) {
  saveWeights(getWeights().filter(w => w.id !== id));
}

function getWeightForDate(dateStr) {
  return getWeights().find(w => w.date === dateStr) || null;
}

function getLatestWeightUpTo(dateStr) {
  const weights = getWeights().filter(w => w.date <= dateStr).sort((a, b) => a.date.localeCompare(b.date));
  return weights.length ? weights[weights.length - 1].weight : null;
}

function getLatestWeight() {
  const weights = getWeights().sort((a, b) => a.date.localeCompare(b.date));
  if (weights.length === 0) return state.profile.currentWeight;
  return weights[weights.length - 1].weight;
}

function getWeeklyWeightTrend() {
  const weights = getWeights().sort((a, b) => a.date.localeCompare(b.date));
  if (weights.length < 3) return null;
  const today = todayStr();
  const thisWeekStart = addDays(today, -6);
  const lastWeekStart = addDays(today, -13);
  const lastWeekEnd = addDays(today, -7);

  const thisWeek = weights.filter(w => w.date >= thisWeekStart);
  const lastWeek = weights.filter(w => w.date >= lastWeekStart && w.date <= lastWeekEnd);
  if (thisWeek.length === 0 || lastWeek.length === 0) return null;

  const avg = arr => arr.reduce((s, w) => s + w.weight, 0) / arr.length;
  return avg(thisWeek) - avg(lastWeek);
}

// ============================================================
// 6. 運動記録データ管理
// ============================================================

function getExercises() {
  return loadJSON(STORAGE_KEYS.EXERCISES, []);
}

function saveExercises(list) {
  saveJSON(STORAGE_KEYS.EXERCISES, list);
}

function addExerciseRecord(record) {
  const list = getExercises();
  record.id = 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  list.push(record);
  saveExercises(list);
}

function deleteExerciseRecord(id) {
  saveExercises(getExercises().filter(e => e.id !== id));
}

function getExercisesForDate(dateStr) {
  return getExercises().filter(e => e.date === dateStr);
}

// 消費カロリー(kcal) ≈ MET × 体重(kg) × 時間(h) × 1.05 という簡易式で見積もる
function estimateExerciseCalories(type, minutes, weight) {
  const met = EXERCISE_MET[type] || 4.0;
  return Math.round(met * weight * (minutes / 60) * 1.05);
}

// ============================================================
// 7. 手持ち食材データ管理
// ============================================================

function getOwnedIngredients() {
  return loadJSON(STORAGE_KEYS.INGREDIENTS, []);
}

function saveOwnedIngredients(list) {
  saveJSON(STORAGE_KEYS.INGREDIENTS, list);
}

function addOwnedIngredient(name) {
  const list = getOwnedIngredients();
  if (!list.includes(name)) {
    list.push(name);
    saveOwnedIngredients(list);
  }
}

function removeOwnedIngredient(name) {
  saveOwnedIngredients(getOwnedIngredients().filter(i => i !== name));
}

// ============================================================
// 8. レシピ検索・おすすめ計算
// ============================================================

// レシピの一致度(0〜100)を計算する。
// 残りの目標栄養価とレシピの栄養価との差を正規化して重み付けし、距離として算出する。
// カロリーを最も重視(40%)し、次にたんぱく質(30%)、脂質・炭水化物(各15%)とする。
// 距離が小さいほど一致度が高くなる。
function calcMatchScore(remaining, recipe) {
  const remKcal = Math.max(remaining.kcal, 50);   // 残りが極端に少ない場合の0除算防止・補正
  const remP = Math.max(remaining.protein, 5);
  const remF = Math.max(remaining.fat, 5);
  const remC = Math.max(remaining.carbs, 5);

  const diffKcal = Math.abs(remKcal - recipe.nutrition.kcal) / remKcal;
  const diffP = Math.abs(remP - recipe.nutrition.protein) / remP;
  const diffF = Math.abs(remF - recipe.nutrition.fat) / remF;
  const diffC = Math.abs(remC - recipe.nutrition.carbs) / remC;

  const distance = diffKcal * 0.4 + diffP * 0.3 + diffF * 0.15 + diffC * 0.15;
  return Math.max(0, Math.round(100 - distance * 100));
}

function getMissingIngredients(recipe) {
  const owned = getOwnedIngredients();
  return recipe.ingredients.filter(ing => !owned.includes(ing));
}

function countOwnedIngredients(recipe) {
  const owned = getOwnedIngredients();
  return recipe.ingredients.filter(ing => owned.includes(ing)).length;
}

function sortRecipes(recipes, sortType, remaining) {
  const copy = [...recipes];
  switch (sortType) {
    case 'kcal-asc':
      return copy.sort((a, b) => a.nutrition.kcal - b.nutrition.kcal);
    case 'protein-desc':
      return copy.sort((a, b) => b.nutrition.protein - a.nutrition.protein);
    case 'stock':
      return copy.sort((a, b) => countOwnedIngredients(b) - countOwnedIngredients(a));
    case 'match':
    default:
      return copy.sort((a, b) => calcMatchScore(remaining, b) - calcMatchScore(remaining, a));
  }
}

// ============================================================
// 9. アドバイス生成（一般的な目安であり、医療的診断ではない）
// ============================================================

function isPastMiddleOfDay() {
  return new Date().getHours() >= 15;
}

function generateAdvice(dateStr) {
  const advice = [];
  const { consumed, targets } = getRemainingNutrients(dateStr);
  const proteinRatio = targets.protein > 0 ? consumed.protein / targets.protein : 0;
  const calorieRatio = targets.calories > 0 ? consumed.kcal / targets.calories : 0;
  const isToday = dateStr === todayStr();

  if (isToday && proteinRatio < 0.5) {
    advice.push('たんぱく質の摂取が目標の半分未満です。鶏胸肉や卵、豆腐などを追加すると目標に近づきます。');
  } else if (proteinRatio >= 0.8 && proteinRatio < 1.1) {
    advice.push(`今日はたんぱく質が目標の${Math.round(proteinRatio * 100)}%です。良いペースです。`);
  }

  if (calorieRatio >= 0.9 && calorieRatio <= 1.05) {
    advice.push('今日は目標カロリーにかなり近づいています。');
  } else if (calorieRatio > 1.1) {
    advice.push('目標カロリーを超えています。次の食事は軽めを意識すると良いでしょう。');
  } else if (isToday && calorieRatio < 0.5 && isPastMiddleOfDay()) {
    advice.push('カロリー摂取がまだ少ないようです。栄養バランスの良い食事を心がけましょう。');
  }

  const trend = getWeeklyWeightTrend();
  if (trend !== null) {
    if (trend < -0.05) {
      advice.push(`今週は体重が先週平均より${Math.abs(trend).toFixed(1)}kg減少しています。順調です。`);
    } else if (trend > 0.05) {
      advice.push(`今週は体重が先週平均より${trend.toFixed(1)}kg増加しています。食事内容を見直してみましょう。`);
    }
  }

  if (advice.length === 0) {
    advice.push('食事や体重を記録して、今日の状態を確認しましょう。');
  }
  advice.push('※このアドバイスは一般的な目安であり、医療的な診断ではありません。');
  return advice;
}

// ============================================================
// 10. 画面描画（UI）
// ============================================================

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function renderScreen(name) {
  switch (name) {
    case 'home': renderHome(); break;
    case 'meals': renderMeals(); break;
    case 'weight': renderWeightScreen(); break;
    case 'exercise': renderExerciseScreen(); break;
    case 'recipes': renderRecipesScreen(); break;
    case 'analysis': renderAnalysis(); break;
    case 'settings': renderSettingsScreen(); break;
  }
}

function renderAll() {
  renderScreen(state.currentScreen);
}

// ---- ホーム ----
function renderHome() {
  const dateStr = state.currentDate;
  document.getElementById('currentDateLabel').textContent = formatDateLabel(dateStr);

  const profile = state.profile;
  const knownWeight = getLatestWeightUpTo(dateStr);
  const displayWeight = knownWeight !== null ? knownWeight : profile.startWeight;

  document.getElementById('homeStartWeight').textContent = profile.startWeight.toFixed(1);
  document.getElementById('homeCurrentWeight').textContent = displayWeight.toFixed(1);
  document.getElementById('homeTargetWeight').textContent = profile.targetWeight.toFixed(1);
  document.getElementById('homeRemainWeight').textContent = Math.abs(displayWeight - profile.targetWeight).toFixed(1);

  const { consumed, targets } = getRemainingNutrients(dateStr);
  document.getElementById('homeCalorieCurrent').textContent = Math.round(consumed.kcal);
  document.getElementById('homeCalorieTarget').textContent = Math.round(targets.calories);
  document.getElementById('homeCalorieBar').style.width = clampPct(consumed.kcal / targets.calories * 100) + '%';
  document.getElementById('homeCalorieRemain').textContent = Math.round(targets.calories - consumed.kcal);

  setPfcDisplay('Protein', consumed.protein, targets.protein);
  setPfcDisplay('Fat', consumed.fat, targets.fat);
  setPfcDisplay('Carbs', consumed.carbs, targets.carbs);

  document.getElementById('homeRemainKcal').textContent = Math.max(0, Math.round(targets.calories - consumed.kcal));
  document.getElementById('homeRemainP').textContent = Math.max(0, Math.round(targets.protein - consumed.protein));
  document.getElementById('homeRemainF').textContent = Math.max(0, Math.round(targets.fat - consumed.fat));
  document.getElementById('homeRemainC').textContent = Math.max(0, Math.round(targets.carbs - consumed.carbs));

  const adviceList = document.getElementById('homeAdviceList');
  adviceList.innerHTML = '';
  generateAdvice(dateStr).forEach(text => adviceList.appendChild(el('li', null, text)));
}

function setPfcDisplay(key, current, target) {
  document.getElementById(`home${key}Current`).textContent = Math.round(current);
  document.getElementById(`home${key}Target`).textContent = Math.round(target);
  document.getElementById(`home${key}Bar`).style.width = clampPct(target > 0 ? current / target * 100 : 0) + '%';
}

// ---- 食事 ----
const MEAL_LABELS = { breakfast: '🌅 朝食', lunch: '☀️ 昼食', dinner: '🌙 夕食', snack: '🍎 間食' };

function renderMeals() {
  document.getElementById('mealsDateLabel').textContent = formatDateLabel(state.currentDate);
  const dayMeals = getMealsForDate(state.currentDate);
  const totals = calcDayTotals(dayMeals);
  const targets = getDailyTargets();
  document.getElementById('mealsSummaryKcal').textContent = `${Math.round(totals.kcal)} / ${targets.calories} kcal`;
  document.getElementById('mealsSummaryPfc').textContent =
    `P ${Math.round(totals.protein)}g　F ${Math.round(totals.fat)}g　C ${Math.round(totals.carbs)}g`;

  ['breakfast', 'lunch', 'dinner', 'snack'].forEach(mealType => {
    const listEl = document.getElementById('foodList-' + mealType);
    listEl.innerHTML = '';
    const items = dayMeals[mealType];
    let mealKcal = 0;
    if (items.length === 0) {
      listEl.appendChild(el('li', 'empty-state', 'まだ記録がありません'));
    } else {
      items.forEach(item => {
        mealKcal += item.kcal;
        listEl.appendChild(buildFoodListItem(mealType, item));
      });
    }
    document.querySelector(`.meal-block[data-meal="${mealType}"] .meal-block-kcal`).textContent = Math.round(mealKcal) + 'kcal';
  });
}

function buildFoodListItem(mealType, item) {
  const li = el('li', 'food-item');
  const info = el('div', 'food-info');
  info.appendChild(el('span', 'food-name', item.name));
  info.appendChild(el('span', 'food-amount', `${item.amount}g`));
  const nutri = el('div', 'food-nutri', `${Math.round(item.kcal)}kcal  P${Math.round(item.protein)} F${Math.round(item.fat)} C${Math.round(item.carbs)}`);
  const actions = el('div', 'food-actions');

  const editBtn = el('button', 'icon-btn-sm', '✎');
  editBtn.setAttribute('aria-label', '編集');
  editBtn.addEventListener('click', () => openFoodModal(mealType, item));

  const delBtn = el('button', 'icon-btn-sm', '🗑');
  delBtn.setAttribute('aria-label', '削除');
  delBtn.addEventListener('click', () => {
    if (confirm(`「${item.name}」を削除しますか？`)) {
      deleteFoodEntry(state.currentDate, mealType, item.id);
      renderMeals();
      renderHome();
    }
  });

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  li.appendChild(info);
  li.appendChild(nutri);
  li.appendChild(actions);
  return li;
}

// ---- 体重 ----
function renderWeightScreen() {
  const profile = state.profile;
  const weights = getWeights().sort((a, b) => a.date.localeCompare(b.date));
  const current = weights.length ? weights[weights.length - 1].weight : profile.startWeight;
  document.getElementById('weightStartValue').textContent = profile.startWeight.toFixed(1);
  document.getElementById('weightCurrentValue').textContent = current.toFixed(1);
  document.getElementById('weightTargetValue').textContent = profile.targetWeight.toFixed(1);

  renderWeightChart();
  renderWeightHistory(weights);
}

function renderWeightHistory(weights) {
  const list = document.getElementById('weightHistoryList');
  list.innerHTML = '';
  if (weights.length === 0) {
    list.appendChild(el('li', 'empty-state', 'まだ記録がありません'));
    return;
  }
  [...weights].reverse().forEach(w => {
    const li = el('li', 'history-item');
    const info = el('div', 'history-info');
    info.appendChild(el('span', 'history-date', formatDateLabel(w.date)));
    info.appendChild(el('span', 'history-value', `${w.weight.toFixed(1)}kg${w.bodyFat ? ' ／ 体脂肪 ' + w.bodyFat + '%' : ''}`));
    if (w.memo) info.appendChild(el('span', 'history-memo', w.memo));
    li.appendChild(info);
    const delBtn = el('button', 'icon-btn-sm', '🗑');
    delBtn.addEventListener('click', () => {
      if (confirm('この記録を削除しますか？')) {
        deleteWeightRecord(w.id);
        renderWeightScreen();
        renderHome();
      }
    });
    li.appendChild(delBtn);
    list.appendChild(li);
  });
}

function renderWeightChart() {
  const canvas = document.getElementById('weightChart');
  const wrap = canvas.parentElement;
  const existingEmpty = wrap.querySelector('.chart-empty');
  if (existingEmpty) existingEmpty.remove();

  const weights = getWeights().sort((a, b) => a.date.localeCompare(b.date));
  let filtered = weights;
  const range = state.weightChartRange;
  if (range !== 'all') {
    const days = Number(range);
    const cutoff = addDays(todayStr(), -days + 1);
    filtered = weights.filter(w => w.date >= cutoff);
  }

  if (state.weightChart) {
    state.weightChart.destroy();
    state.weightChart = null;
  }

  if (filtered.length === 0) {
    canvas.classList.add('hidden');
    wrap.appendChild(el('div', 'chart-empty', 'データがありません。体重を記録してみましょう。'));
    return;
  }
  canvas.classList.remove('hidden');

  const labels = filtered.map(w => formatDateShort(w.date));
  const data = filtered.map(w => w.weight);

  state.weightChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '体重(kg)',
          data,
          borderColor: '#2f9e6e',
          backgroundColor: 'rgba(47,158,110,0.15)',
          tension: 0.3,
          fill: true,
          pointRadius: 3
        },
        {
          label: '目標体重',
          data: labels.map(() => state.profile.targetWeight),
          borderColor: '#ff9f43',
          borderDash: [6, 4],
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true, position: 'bottom' } },
      scales: { y: { ticks: { callback: v => v + 'kg' } } }
    }
  });
}

// ---- 運動 ----
function renderExerciseScreen() {
  const todays = getExercisesForDate(todayStr());
  const total = todays.reduce((s, e) => s + e.calories, 0);
  document.getElementById('exerciseTodayTotal').textContent = Math.round(total);

  const list = document.getElementById('exerciseHistoryList');
  list.innerHTML = '';
  const all = [...getExercises()].sort((a, b) => b.date.localeCompare(a.date));
  if (all.length === 0) {
    list.appendChild(el('li', 'empty-state', 'まだ記録がありません'));
    return;
  }
  all.forEach(ex => {
    const li = el('li', 'history-item');
    const info = el('div', 'history-info');
    info.appendChild(el('span', 'history-date', formatDateLabel(ex.date)));
    info.appendChild(el('span', 'history-value', `${EXERCISE_TYPE_LABELS[ex.type] || ex.type} ／ ${ex.duration}分 ／ ${Math.round(ex.calories)}kcal`));
    li.appendChild(info);
    const delBtn = el('button', 'icon-btn-sm', '🗑');
    delBtn.addEventListener('click', () => {
      if (confirm('この記録を削除しますか？')) {
        deleteExerciseRecord(ex.id);
        renderExerciseScreen();
      }
    });
    li.appendChild(delBtn);
    list.appendChild(li);
  });
}

// ---- レシピ ----
function renderRecipesScreen() {
  const remaining = getRemainingNutrients(todayStr());
  document.getElementById('recipeRemainKcal').textContent = Math.max(0, Math.round(remaining.kcal));
  document.getElementById('recipeRemainP').textContent = Math.max(0, Math.round(remaining.protein));
  document.getElementById('recipeRemainF').textContent = Math.max(0, Math.round(remaining.fat));
  document.getElementById('recipeRemainC').textContent = Math.max(0, Math.round(remaining.carbs));

  const sorted = sortRecipes(RECIPE_DATABASE, state.recipeSort, remaining);
  const listEl = document.getElementById('recipeList');
  listEl.innerHTML = '';
  sorted.forEach(recipe => listEl.appendChild(buildRecipeCard(recipe, remaining)));
}

function buildRecipeCard(recipe, remaining) {
  const card = el('div', 'recipe-card');
  card.appendChild(el('div', 'recipe-image-placeholder', '🍽'));

  const body = el('div', 'recipe-card-body');
  body.appendChild(el('div', 'recipe-name', recipe.name));

  const score = calcMatchScore(remaining, recipe);
  body.appendChild(el('span', 'match-badge', `一致度 ${score}%`));

  body.appendChild(el('div', 'recipe-nutri',
    `${recipe.nutrition.kcal}kcal ｜ P${recipe.nutrition.protein} F${recipe.nutrition.fat} C${recipe.nutrition.carbs}`));
  body.appendChild(el('div', 'recipe-time', `調理時間 約${recipe.cookTime}分`));

  const missing = getMissingIngredients(recipe);
  if (missing.length === 0) {
    body.appendChild(el('div', 'recipe-stock-ok', '✓ 今ある食材で作れます'));
  } else if (missing.length <= 2) {
    body.appendChild(el('div', 'recipe-stock-missing', `あと${missing.join('、')}があれば作れます`));
  } else {
    body.appendChild(el('div', 'recipe-stock-missing', `不足食材: ${missing.length}品`));
  }

  card.appendChild(body);
  card.addEventListener('click', () => openRecipeDetail(recipe));
  return card;
}

function openRecipeDetail(recipe) {
  const modalBody = document.getElementById('modalBody');
  modalBody.innerHTML = '';
  modalBody.appendChild(el('div', 'recipe-detail-image', '🍽'));
  modalBody.appendChild(el('h2', 'modal-title', recipe.name));
  modalBody.appendChild(el('div', 'recipe-detail-nutri',
    `${recipe.nutrition.kcal}kcal ｜ P${recipe.nutrition.protein}g F${recipe.nutrition.fat}g C${recipe.nutrition.carbs}g`));
  modalBody.appendChild(el('div', 'recipe-detail-time', `調理時間: 約${recipe.cookTime}分`));

  modalBody.appendChild(el('h3', 'modal-subtitle', '材料'));
  const owned = getOwnedIngredients();
  const ingList = el('ul', 'ingredient-list');
  recipe.ingredients.forEach(ing => {
    ingList.appendChild(el('li', owned.includes(ing) ? 'ingredient-owned' : 'ingredient-missing', ing));
  });
  modalBody.appendChild(ingList);

  modalBody.appendChild(el('h3', 'modal-subtitle', '作り方'));
  const stepsList = el('ol', 'steps-list');
  recipe.steps.forEach(step => stepsList.appendChild(el('li', null, step)));
  modalBody.appendChild(stepsList);

  showModal();
}

// ---- 分析 ----
function getDateRangeList(days) {
  if (days === null) {
    const weights = getWeights();
    const meals = getMealsData();
    const allDates = [...weights.map(w => w.date), ...Object.keys(meals)];
    if (allDates.length === 0) return [todayStr()];
    const minDate = allDates.sort()[0];
    const list = [];
    let d = minDate;
    while (d <= todayStr()) {
      list.push(d);
      d = addDays(d, 1);
    }
    return list;
  }
  const list = [];
  for (let i = days - 1; i >= 0; i--) list.push(addDays(todayStr(), -i));
  return list;
}

function renderAnalysis() {
  const range = state.analysisRange;
  const days = range === 'all' ? null : Number(range);
  const dateList = getDateRangeList(days);

  renderAnalysisWeightChart(dateList);
  renderAnalysisCalorieChart(dateList);
  renderAnalysisPfcChart(dateList);
  renderAnalysisSummary(dateList);
}

function renderAnalysisWeightChart(dateList) {
  const canvas = document.getElementById('analysisWeightChart');
  const weights = getWeights();
  const data = dateList.map(d => {
    const w = weights.find(w => w.date === d);
    return w ? w.weight : null;
  });
  if (state.analysisCharts.weight) state.analysisCharts.weight.destroy();
  state.analysisCharts.weight = new Chart(canvas, {
    type: 'line',
    data: { labels: dateList.map(formatDateShort), datasets: [{ label: '体重(kg)', data, spanGaps: true, borderColor: '#2f9e6e', backgroundColor: 'rgba(47,158,110,0.1)', tension: 0.3 }] },
    options: { responsive: true, plugins: { title: { display: true, text: '体重推移' } } }
  });
}

function renderAnalysisCalorieChart(dateList) {
  const canvas = document.getElementById('analysisCalorieChart');
  const meals = getMealsData();
  const targets = getDailyTargets();
  const data = dateList.map(d => (meals[d] ? calcDayTotals(meals[d]).kcal : 0));
  if (state.analysisCharts.calorie) state.analysisCharts.calorie.destroy();
  state.analysisCharts.calorie = new Chart(canvas, {
    data: {
      labels: dateList.map(formatDateShort),
      datasets: [
        { type: 'bar', label: '摂取カロリー', data, backgroundColor: '#2f9e6e' },
        { type: 'line', label: '目標カロリー', data: dateList.map(() => targets.calories), borderColor: '#ff9f43', pointRadius: 0 }
      ]
    },
    options: { responsive: true, plugins: { title: { display: true, text: '摂取カロリー推移' } } }
  });
}

function renderAnalysisPfcChart(dateList) {
  const canvas = document.getElementById('analysisPfcChart');
  const meals = getMealsData();
  let totalP = 0, totalF = 0, totalC = 0, count = 0;
  dateList.forEach(d => {
    if (meals[d]) {
      const t = calcDayTotals(meals[d]);
      totalP += t.protein; totalF += t.fat; totalC += t.carbs; count++;
    }
  });
  const avg = count ? { p: totalP / count, f: totalF / count, c: totalC / count } : { p: 0, f: 0, c: 0 };
  if (state.analysisCharts.pfc) state.analysisCharts.pfc.destroy();
  state.analysisCharts.pfc = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['たんぱく質(g)', '脂質(g)', '炭水化物(g)'],
      datasets: [{ data: [roundTo1(avg.p), roundTo1(avg.f), roundTo1(avg.c)], backgroundColor: ['#2f9e6e', '#ff9f43', '#5b8def'] }]
    },
    options: { responsive: true, plugins: { title: { display: true, text: '平均PFCバランス' } } }
  });
}

function renderAnalysisSummary(dateList) {
  const container = document.getElementById('analysisSummary');
  container.innerHTML = '';
  const meals = getMealsData();
  const exercises = getExercises().filter(e => dateList.includes(e.date));
  const targets = getDailyTargets();

  let totalKcal = 0, daysWithData = 0, achievedDays = 0;
  dateList.forEach(d => {
    if (meals[d]) {
      const t = calcDayTotals(meals[d]);
      totalKcal += t.kcal;
      daysWithData++;
      if (Math.abs(t.kcal - targets.calories) <= targets.calories * 0.1) achievedDays++;
    }
  });
  const avgKcal = daysWithData ? Math.round(totalKcal / daysWithData) : 0;
  const totalExerciseKcal = exercises.reduce((s, e) => s + e.calories, 0);
  const achieveRate = daysWithData ? Math.round((achievedDays / daysWithData) * 100) : 0;

  container.appendChild(el('div', 'card-title', '期間サマリー'));
  container.appendChild(el('div', 'stat-row', `平均摂取カロリー: ${avgKcal} kcal / 日`));
  container.appendChild(el('div', 'stat-row', `運動による消費カロリー合計: ${Math.round(totalExerciseKcal)} kcal`));
  container.appendChild(el('div', 'stat-row', `目標カロリー達成率(±10%以内): ${achieveRate}%`));
}

// ---- 設定 ----
function renderSettingsScreen() {
  const p = state.profile;
  document.getElementById('settingsAge').value = p.age;
  document.getElementById('settingsGender').value = p.gender;
  document.getElementById('settingsHeight').value = p.height;
  document.getElementById('settingsTargetWeight').value = p.targetWeight;
  document.getElementById('settingsPeriod').value = p.periodWeeks;
  document.getElementById('settingsActivity').value = p.activity;
  document.getElementById('settingsProteinRatio').value = p.pfcRatio.protein;
  document.getElementById('settingsFatRatio').value = p.pfcRatio.fat;
  document.getElementById('settingsCarbsRatio').value = p.pfcRatio.carbs;
  updatePfcRatioSum();

  const { bmr, tdee, target } = calcTargetCalories(getEffectiveProfile());
  const bmi = calcBMI(getLatestWeight(), p.height);
  document.getElementById('settingsCalcInfo').textContent =
    `BMI: ${bmi.toFixed(1)}　／　基礎代謝: ${Math.round(bmr)}kcal　／　推定消費(TDEE): ${Math.round(tdee)}kcal　／　目標摂取: ${Math.round(target)}kcal`;

  document.getElementById('geminiApiKeyInput').value = getGeminiApiKey();
}

function updatePfcRatioSum() {
  const p = Number(document.getElementById('settingsProteinRatio').value) || 0;
  const f = Number(document.getElementById('settingsFatRatio').value) || 0;
  const c = Number(document.getElementById('settingsCarbsRatio').value) || 0;
  const sum = p + f + c;
  const label = document.getElementById('pfcRatioSumLabel');
  label.textContent = `合計: ${sum}% ${sum === 100 ? '(OK)' : '(100%になるよう調整してください)'}`;
  label.classList.toggle('error-text', sum !== 100);
}

// ============================================================
// 11. モーダル
// ============================================================

function showModal() {
  document.getElementById('modalOverlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  document.getElementById('modalBody').innerHTML = '';
}

let toastTimer = null;
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function showLoading(visible) {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !visible);
}

// ---- 食品追加/編集モーダル ----
function openFoodModal(mealType, existingItem) {
  state.pendingMealType = mealType;
  const modalBody = document.getElementById('modalBody');
  modalBody.innerHTML = '';
  modalBody.appendChild(el('h2', 'modal-title', existingItem ? '食品を編集' : `${MEAL_LABELS[mealType]}に追加`));

  if (!existingItem) {
    const photoBtn = el('button', 'btn-secondary full-width', '📷 写真でまとめて記録する');
    photoBtn.addEventListener('click', () => openPhotoModal(mealType));
    modalBody.appendChild(photoBtn);
    modalBody.appendChild(el('div', 'sub-line divider-line', 'または食品を検索して追加'));

    const searchWrap = el('div', 'search-wrap');
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '食品名を検索(例: 鶏胸肉)';
    input.className = 'text-input';
    input.id = 'foodSearchInput';
    searchWrap.appendChild(input);
    modalBody.appendChild(searchWrap);

    const resultsList = el('ul', 'search-results');
    resultsList.id = 'foodSearchResults';
    modalBody.appendChild(resultsList);

    let debounceTimer;
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => performFoodSearch(input.value), 300);
    });
    performFoodSearch('');
  } else {
    const ratio = existingItem.amount > 0 ? existingItem.amount / 100 : 1;
    const pseudoFood = {
      id: existingItem.foodId,
      name: existingItem.name,
      unit: 100,
      kcal: existingItem.kcal / ratio,
      protein: existingItem.protein / ratio,
      fat: existingItem.fat / ratio,
      carbs: existingItem.carbs / ratio
    };
    renderFoodAmountForm(modalBody, pseudoFood, existingItem.amount, existingItem.id);
  }

  showModal();
}

async function performFoodSearch(query) {
  const resultsList = document.getElementById('foodSearchResults');
  if (!resultsList) return;
  resultsList.innerHTML = '';

  const q = query.trim();
  const localMatches = q === '' ? FOOD_DATABASE.slice(0, 8) : FOOD_DATABASE.filter(f => f.name.includes(q));
  localMatches.forEach(food => resultsList.appendChild(buildFoodResultItem(food)));

  if (q.length >= 2) {
    showLoading(true);
    try {
      const apiResults = await searchFoodFromApi(q);
      apiResults.forEach(food => {
        if (!localMatches.some(l => l.name === food.name)) {
          resultsList.appendChild(buildFoodResultItem(food));
        }
      });
    } catch (e) {
      console.warn('API検索エラー', e);
    } finally {
      showLoading(false);
    }
  }

  if (resultsList.children.length === 0) {
    resultsList.appendChild(el('li', 'empty-state', '該当する食品が見つかりませんでした'));
  }
}

function buildFoodResultItem(food) {
  const li = el('li', 'search-result-item');
  li.appendChild(el('span', 'result-name', food.name));
  li.appendChild(el('span', 'result-kcal', `${Math.round(food.kcal)}kcal/100g`));
  li.addEventListener('click', () => {
    const modalBody = document.getElementById('modalBody');
    modalBody.innerHTML = '';
    modalBody.appendChild(el('h2', 'modal-title', `${MEAL_LABELS[state.pendingMealType]}に追加`));
    renderFoodAmountForm(modalBody, food, 100, null);
  });
  return li;
}

function renderFoodAmountForm(container, food, defaultAmount, editingId) {
  const card = el('div', 'selected-food-card');
  card.appendChild(el('div', 'selected-food-name', food.name));
  container.appendChild(card);

  container.appendChild(el('label', 'form-label', '量 (g)'));
  const amountInput = document.createElement('input');
  amountInput.type = 'number';
  amountInput.min = '1';
  amountInput.step = '1';
  amountInput.value = Math.round(defaultAmount);
  amountInput.className = 'text-input';
  container.appendChild(amountInput);

  const preview = el('div', 'nutri-preview');
  container.appendChild(preview);

  const updatePreview = () => {
    const amount = Number(amountInput.value) || 0;
    const ratio = amount / (food.unit || 100);
    preview.textContent =
      `${Math.round(food.kcal * ratio)}kcal ｜ P${roundTo1(food.protein * ratio)}g ｜ F${roundTo1(food.fat * ratio)}g ｜ C${roundTo1(food.carbs * ratio)}g`;
  };
  amountInput.addEventListener('input', updatePreview);
  updatePreview();

  const saveBtn = el('button', 'btn-primary full-width', editingId ? '更新する' : '記録する');
  saveBtn.addEventListener('click', () => {
    const amount = Number(amountInput.value);
    if (!amount || amount <= 0) {
      showToast('正しい量を入力してください', 'error');
      return;
    }
    const entry = buildFoodEntry(food, amount);
    if (editingId) {
      updateFoodEntry(state.currentDate, state.pendingMealType, editingId, entry);
      showToast('食品を更新しました', 'success');
    } else {
      addFoodEntry(state.currentDate, state.pendingMealType, entry);
      showToast('食品を記録しました', 'success');
    }
    closeModal();
    renderMeals();
    renderHome();
  });
  container.appendChild(saveBtn);
}

// ---- 写真からのAI栄養解析モーダル ----
function openPhotoModal(mealType) {
  state.pendingMealType = mealType;
  const modalBody = document.getElementById('modalBody');
  modalBody.innerHTML = '';
  modalBody.appendChild(el('h2', 'modal-title', `${MEAL_LABELS[mealType]}を写真で記録`));

  if (!getGeminiApiKey()) {
    modalBody.appendChild(el('div', 'empty-state', 'この機能を使うには、設定画面でAI画像認識用のAPIキー(Google Gemini)を登録してください。'));
    const goSettingsBtn = el('button', 'btn-primary full-width', '設定画面を開く');
    goSettingsBtn.addEventListener('click', () => {
      closeModal();
      showScreen('settings');
    });
    modalBody.appendChild(goSettingsBtn);
    const backBtn = el('button', 'link-btn', '← 食品検索に戻る');
    backBtn.addEventListener('click', () => openFoodModal(mealType, null));
    modalBody.appendChild(backBtn);
    showModal();
    return;
  }

  modalBody.appendChild(el('div', 'sub-line', '食事の写真を選択すると、AIが料理・分量・カロリー/PFCを推定します(概算値です)。'));

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.className = 'text-input';
  modalBody.appendChild(fileInput);

  const previewWrap = el('div', 'photo-preview-wrap');
  modalBody.appendChild(previewWrap);

  const analyzeBtn = el('button', 'btn-primary full-width', 'AIで解析する');
  analyzeBtn.disabled = true;
  modalBody.appendChild(analyzeBtn);

  const backBtn = el('button', 'link-btn', '手動で食品を検索する');
  backBtn.addEventListener('click', () => openFoodModal(mealType, null));
  modalBody.appendChild(backBtn);

  let currentPhoto = null;

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    previewWrap.innerHTML = '';
    analyzeBtn.disabled = true;
    currentPhoto = null;
    try {
      const resized = await resizeImageForAnalysis(file);
      currentPhoto = resized;
      const img = document.createElement('img');
      img.className = 'photo-preview-img';
      img.src = resized.previewUrl;
      previewWrap.appendChild(img);
      analyzeBtn.disabled = false;
    } catch (err) {
      showToast((err && err.message) || '画像の読み込みに失敗しました', 'error');
    }
  });

  analyzeBtn.addEventListener('click', async () => {
    if (!currentPhoto) return;
    analyzeBtn.disabled = true;
    showLoading(true);
    try {
      const items = await analyzeMealPhoto(currentPhoto.base64, currentPhoto.mimeType);
      renderPhotoAnalysisResult(modalBody, items, mealType);
    } catch (err) {
      showToast((err && err.message) || 'AI解析に失敗しました', 'error');
      analyzeBtn.disabled = false;
    } finally {
      showLoading(false);
    }
  });

  showModal();
}

function renderPhotoAnalysisResult(container, items, mealType) {
  container.innerHTML = '';
  container.appendChild(el('h2', 'modal-title', 'AIによる解析結果'));
  container.appendChild(el('div', 'sub-line', 'AIによる概算値です。内容を確認し、必要に応じて数値を修正してから記録してください。'));

  const rows = items.map(item => buildPhotoResultRow(container, item));

  const saveBtn = el('button', 'btn-primary full-width', 'チェックした項目を記録する');
  saveBtn.addEventListener('click', () => {
    let addedCount = 0;
    rows.forEach(row => {
      if (!row.checkbox.checked) return;
      const amount = Number(row.amountInput.value);
      const kcal = Number(row.kcalInput.value) || 0;
      const protein = Number(row.proteinInput.value) || 0;
      const fat = Number(row.fatInput.value) || 0;
      const carbs = Number(row.carbsInput.value) || 0;
      if (!amount || amount <= 0) return;
      addFoodEntry(state.currentDate, mealType, {
        name: row.nameInput.value.trim() || '写真から記録した食品',
        amount, kcal, protein, fat, carbs
      });
      addedCount++;
    });
    if (addedCount === 0) {
      showToast('記録する項目を選択してください', 'error');
      return;
    }
    showToast(`${addedCount}件の食品を記録しました`, 'success');
    closeModal();
    renderMeals();
    renderHome();
  });
  container.appendChild(saveBtn);

  const retryBtn = el('button', 'link-btn', '別の写真を選び直す');
  retryBtn.addEventListener('click', () => openPhotoModal(mealType));
  container.appendChild(retryBtn);
}

function buildPhotoResultRow(container, item) {
  const card = el('div', 'photo-result-card');

  const headerRow = el('div', 'photo-result-header');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = true;
  headerRow.appendChild(checkbox);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'text-input';
  nameInput.value = item.name;
  headerRow.appendChild(nameInput);
  card.appendChild(headerRow);

  const grid = el('div', 'photo-result-grid');
  const amountInput = buildLabeledNumberInput(grid, '量(g)', item.amount);
  const kcalInput = buildLabeledNumberInput(grid, 'kcal', item.kcal);
  const proteinInput = buildLabeledNumberInput(grid, 'P(g)', item.protein);
  const fatInput = buildLabeledNumberInput(grid, 'F(g)', item.fat);
  const carbsInput = buildLabeledNumberInput(grid, 'C(g)', item.carbs);
  card.appendChild(grid);

  container.appendChild(card);

  return { checkbox, nameInput, amountInput, kcalInput, proteinInput, fatInput, carbsInput };
}

function buildLabeledNumberInput(container, labelText, value) {
  const wrap = el('div', 'photo-result-field');
  wrap.appendChild(el('label', 'form-label-sm', labelText));
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.1';
  input.className = 'text-input';
  input.value = value;
  wrap.appendChild(input);
  container.appendChild(wrap);
  return input;
}

// ---- 体重記録モーダル ----
function openWeightModal() {
  const modalBody = document.getElementById('modalBody');
  modalBody.innerHTML = '';
  modalBody.appendChild(el('h2', 'modal-title', '体重を記録'));

  const existing = getWeightForDate(state.currentDate);

  modalBody.appendChild(el('label', 'form-label', '日付'));
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'text-input';
  dateInput.value = existing ? existing.date : state.currentDate;
  modalBody.appendChild(dateInput);

  modalBody.appendChild(el('label', 'form-label', '体重(kg)'));
  const weightInput = document.createElement('input');
  weightInput.type = 'number';
  weightInput.step = '0.1';
  weightInput.className = 'text-input';
  weightInput.value = existing ? existing.weight : '';
  modalBody.appendChild(weightInput);

  modalBody.appendChild(el('label', 'form-label', '体脂肪率(%) (任意)'));
  const bodyFatInput = document.createElement('input');
  bodyFatInput.type = 'number';
  bodyFatInput.step = '0.1';
  bodyFatInput.className = 'text-input';
  bodyFatInput.value = existing && existing.bodyFat ? existing.bodyFat : '';
  modalBody.appendChild(bodyFatInput);

  modalBody.appendChild(el('label', 'form-label', 'メモ (任意)'));
  const memoInput = document.createElement('textarea');
  memoInput.className = 'text-input';
  memoInput.rows = 2;
  memoInput.value = existing && existing.memo ? existing.memo : '';
  modalBody.appendChild(memoInput);

  const saveBtn = el('button', 'btn-primary full-width', '保存する');
  saveBtn.addEventListener('click', () => {
    const date = dateInput.value;
    const weight = Number(weightInput.value);
    if (!date || !weight || weight <= 0) {
      showToast('日付と体重を正しく入力してください', 'error');
      return;
    }
    addWeightRecord({
      date,
      weight,
      bodyFat: bodyFatInput.value ? Number(bodyFatInput.value) : null,
      memo: memoInput.value.trim()
    });
    showToast('体重を記録しました', 'success');
    closeModal();
    renderWeightScreen();
    renderHome();
  });
  modalBody.appendChild(saveBtn);
  showModal();
}

// ---- 運動記録モーダル ----
function openExerciseModal() {
  const modalBody = document.getElementById('modalBody');
  modalBody.innerHTML = '';
  modalBody.appendChild(el('h2', 'modal-title', '運動を記録'));

  modalBody.appendChild(el('label', 'form-label', '種類'));
  const typeSelect = document.createElement('select');
  typeSelect.className = 'text-input';
  Object.entries(EXERCISE_TYPE_LABELS).forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    typeSelect.appendChild(opt);
  });
  modalBody.appendChild(typeSelect);

  modalBody.appendChild(el('label', 'form-label', '日付'));
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'text-input';
  dateInput.value = todayStr();
  modalBody.appendChild(dateInput);

  modalBody.appendChild(el('label', 'form-label', '時間(分)'));
  const durationInput = document.createElement('input');
  durationInput.type = 'number';
  durationInput.min = '1';
  durationInput.className = 'text-input';
  durationInput.value = 30;
  modalBody.appendChild(durationInput);

  modalBody.appendChild(el('label', 'form-label', '消費カロリー(kcal)'));
  const caloriesInput = document.createElement('input');
  caloriesInput.type = 'number';
  caloriesInput.min = '0';
  caloriesInput.className = 'text-input';
  modalBody.appendChild(caloriesInput);

  const updateEstimate = () => {
    const weight = getLatestWeight();
    caloriesInput.value = estimateExerciseCalories(typeSelect.value, Number(durationInput.value) || 0, weight);
  };
  typeSelect.addEventListener('change', updateEstimate);
  durationInput.addEventListener('input', updateEstimate);
  updateEstimate();

  const saveBtn = el('button', 'btn-primary full-width', '記録する');
  saveBtn.addEventListener('click', () => {
    const duration = Number(durationInput.value);
    const calories = Number(caloriesInput.value);
    if (!duration || duration <= 0 || calories < 0) {
      showToast('時間と消費カロリーを正しく入力してください', 'error');
      return;
    }
    addExerciseRecord({ type: typeSelect.value, date: dateInput.value, duration, calories });
    showToast('運動を記録しました', 'success');
    closeModal();
    renderExerciseScreen();
  });
  modalBody.appendChild(saveBtn);
  showModal();
}

// ---- 手持ち食材モーダル ----
function openIngredientsModal() {
  const modalBody = document.getElementById('modalBody');
  modalBody.innerHTML = '';
  modalBody.appendChild(el('h2', 'modal-title', '手持ち食材'));

  const addRow = el('div', 'ingredient-add-row');
  const select = document.createElement('select');
  select.className = 'text-input';
  FOOD_DATABASE.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.name;
    opt.textContent = f.name;
    select.appendChild(opt);
  });
  addRow.appendChild(select);
  const addBtn = el('button', 'btn-secondary', '追加');
  addRow.appendChild(addBtn);
  modalBody.appendChild(addRow);

  const listEl = el('ul', 'owned-ingredient-list');
  modalBody.appendChild(listEl);

  addBtn.addEventListener('click', () => {
    addOwnedIngredient(select.value);
    renderIngredientsList(listEl);
    renderRecipesScreen();
  });

  renderIngredientsList(listEl);
  showModal();
}

function renderIngredientsList(listEl) {
  listEl.innerHTML = '';
  const owned = getOwnedIngredients();
  if (owned.length === 0) {
    listEl.appendChild(el('li', 'empty-state', 'まだ登録されていません'));
    return;
  }
  owned.forEach(name => {
    const li = el('li', 'owned-ingredient-item');
    li.appendChild(el('span', null, name));
    const delBtn = el('button', 'icon-btn-sm', '✕');
    delBtn.addEventListener('click', () => {
      removeOwnedIngredient(name);
      renderIngredientsList(listEl);
      renderRecipesScreen();
    });
    li.appendChild(delBtn);
    listEl.appendChild(li);
  });
}

// ============================================================
// 12. データエクスポート/インポート/削除
// ============================================================

function exportData() {
  const data = {
    profile: state.profile,
    meals: getMealsData(),
    weights: getWeights(),
    exercises: getExercises(),
    ingredients: getOwnedIngredients(),
    exportedAt: new Date().toISOString(),
    version: 1
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `diet-data-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('データをエクスポートしました', 'success');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.profile) throw new Error('プロフィール情報が見つかりません');
      if (!confirm('現在のデータを上書きしてインポートします。よろしいですか？')) return;
      saveProfile(data.profile);
      saveJSON(STORAGE_KEYS.MEALS, data.meals || {});
      saveJSON(STORAGE_KEYS.WEIGHTS, data.weights || []);
      saveJSON(STORAGE_KEYS.EXERCISES, data.exercises || []);
      saveJSON(STORAGE_KEYS.INGREDIENTS, data.ingredients || []);
      localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
      showToast('データをインポートしました', 'success');
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      showToast('インポートに失敗しました: ' + err.message, 'error');
    }
  };
  reader.onerror = () => showToast('ファイルの読み込みに失敗しました', 'error');
  reader.readAsText(file);
}

function deleteAllData() {
  if (!confirm('本当に全てのデータを削除しますか？この操作は取り消せません。')) return;
  if (!confirm('最終確認: 全データが削除されます。よろしいですか？')) return;
  Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
  location.reload();
}

// ============================================================
// 13. 画面遷移・イベント登録・初期化
// ============================================================

function showScreen(name) {
  state.currentScreen = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.bottom-nav button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.screen === name);
  });
  renderScreen(name);
  window.scrollTo(0, 0);
}

function bindEvents() {
  document.querySelectorAll('.bottom-nav button').forEach(btn => {
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
  });
  document.getElementById('settingsBtn').addEventListener('click', () => showScreen('settings'));
  document.getElementById('backToHomeFromSettings').addEventListener('click', () => showScreen('home'));

  document.getElementById('prevDayBtn').addEventListener('click', () => {
    state.currentDate = addDays(state.currentDate, -1);
    renderHome();
  });
  document.getElementById('nextDayBtn').addEventListener('click', () => {
    state.currentDate = addDays(state.currentDate, 1);
    renderHome();
  });
  document.getElementById('mealsPrevDayBtn').addEventListener('click', () => {
    state.currentDate = addDays(state.currentDate, -1);
    renderMeals();
  });
  document.getElementById('mealsNextDayBtn').addEventListener('click', () => {
    state.currentDate = addDays(state.currentDate, 1);
    renderMeals();
  });

  document.querySelectorAll('.add-food-btn').forEach(btn => {
    btn.addEventListener('click', () => openFoodModal(btn.dataset.meal, null));
  });

  document.getElementById('addWeightBtn').addEventListener('click', openWeightModal);
  document.getElementById('addExerciseBtn').addEventListener('click', openExerciseModal);
  document.getElementById('manageIngredientsBtn').addEventListener('click', openIngredientsModal);
  document.getElementById('homeSuggestBtn').addEventListener('click', () => showScreen('recipes'));

  document.querySelectorAll('[data-action="add-meal"]').forEach(b => b.addEventListener('click', () => showScreen('meals')));
  document.querySelectorAll('[data-action="add-weight"]').forEach(b => b.addEventListener('click', openWeightModal));
  document.querySelectorAll('[data-action="add-exercise"]').forEach(b => b.addEventListener('click', openExerciseModal));

  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeModal();
  });
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);

  document.querySelectorAll('.weight-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.weight-range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.weightChartRange = btn.dataset.range;
      renderWeightChart();
    });
  });
  document.querySelectorAll('.analysis-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.analysis-range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.analysisRange = btn.dataset.analysisRange;
      renderAnalysis();
    });
  });

  document.getElementById('recipeSortSelect').addEventListener('change', (e) => {
    state.recipeSort = e.target.value;
    renderRecipesScreen();
  });

  document.getElementById('settingsForm').addEventListener('submit', handleSettingsSubmit);
  ['settingsProteinRatio', 'settingsFatRatio', 'settingsCarbsRatio'].forEach(id => {
    document.getElementById(id).addEventListener('input', updatePfcRatioSum);
  });

  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('deleteAllBtn').addEventListener('click', deleteAllData);

  document.getElementById('saveGeminiKeyBtn').addEventListener('click', () => {
    const key = document.getElementById('geminiApiKeyInput').value.trim();
    if (!key) {
      showToast('APIキーを入力してください', 'error');
      return;
    }
    saveGeminiApiKey(key);
    showToast('APIキーを保存しました', 'success');
  });
  document.getElementById('clearGeminiKeyBtn').addEventListener('click', () => {
    if (!getGeminiApiKey()) return;
    if (!confirm('保存されているAPIキーを削除しますか？')) return;
    saveGeminiApiKey('');
    document.getElementById('geminiApiKeyInput').value = '';
    showToast('APIキーを削除しました', 'success');
  });
}

function init() {
  const initialized = localStorage.getItem(STORAGE_KEYS.INITIALIZED) === 'true';
  state.profile = loadJSON(STORAGE_KEYS.PROFILE, null);
  state.currentDate = todayStr();

  if (!initialized || !state.profile) {
    document.getElementById('onboardingForm').addEventListener('submit', handleOnboardingSubmit);
    return;
  }

  document.getElementById('screen-onboarding').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  bindEvents();
  showScreen('home');
}

document.addEventListener('DOMContentLoaded', init);

// PWA対応: Service Workerを登録し、ホーム画面への追加・オフライン起動を可能にする。
// 非対応環境やhttps/localhost以外での配信時は登録に失敗するが、
// その場合も通常のWebアプリとして問題なく動作を続ける。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service Workerの登録に失敗しました(オフライン対応なしで動作します):', err && err.message);
    });
  });
}
