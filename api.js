'use strict';

/*
 * api.js
 * 外部APIとの通信を担当するモジュール。
 * 将来的に食品データを拡張できるよう、API通信処理をこのファイルに分離している。
 *   1. Open Food Facts API（食品検索。APIキー不要）
 *   2. Google Gemini API（食事写真からのカロリー・PFC推定。ユーザー自身のAPIキーが必要）
 * いずれもAPI通信に失敗した場合にアプリ本体が停止しないよう配慮している。
 */

const OFF_API_BASE = 'https://world.openfoodfacts.org/cgi/search.pl';

// Open Food Facts の利用規約に従い、アプリを識別する情報をリクエストに含める。
// ブラウザのfetchはUser-Agentヘッダーを自由に書き換えられないため、
// 公式が推奨するapp_nameクエリパラメータでアプリ識別子を送る。
const APP_IDENTIFIER = 'DietManagerApp/1.0 (browser-based; contact: local-user)';
const API_TIMEOUT_MS = 6000;

/**
 * Open Food Facts から食品名で検索する。
 * @param {string} query 検索キーワード
 * @returns {Promise<Array>} アプリ内共通の食品オブジェクトの配列（失敗時は空配列）
 */
async function searchFoodFromApi(query) {
  if (!query || query.trim().length < 2) return [];
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return [];

  const url = `${OFF_API_BASE}?search_terms=${encodeURIComponent(query)}` +
    `&search_simple=1&action=process&json=1&page_size=15&fields=code,product_name,nutriments` +
    `&app_name=${encodeURIComponent(APP_IDENTIFIER)}`;

  let controller;
  let timeoutId;
  try {
    controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': APP_IDENTIFIER
      }
    });

    if (!response.ok) {
      throw new Error('APIレスポンスが不正です (status: ' + response.status + ')');
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.products)) return [];

    return data.products
      .map(normalizeOffProduct)
      .filter(item => item !== null)
      .slice(0, 15);
  } catch (error) {
    // API通信に失敗した場合はローカル食品データへフォールバックするため、
    // ここでは警告のみを出しアプリの動作は止めない。
    console.warn('食品API検索に失敗したため、ローカルデータのみで続行します:', error && error.message);
    return [];
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Open Food Facts のレスポンス形式を、アプリ内で使用する食品オブジェクト形式に変換する。
 * 必要な栄養情報(kcal/protein/fat/carbs)が無い商品はnullを返して除外する。
 */
function normalizeOffProduct(product) {
  if (!product || !product.product_name) return null;
  const n = product.nutriments || {};
  const kcalRaw = n['energy-kcal_100g'];
  if (kcalRaw === undefined || kcalRaw === null || isNaN(kcalRaw)) return null;

  return {
    id: 'off_' + (product.code || Math.random().toString(36).slice(2)),
    name: String(product.product_name).trim().slice(0, 60),
    category: 'API検索結果',
    unit: 100,
    kcal: Math.round(Number(kcalRaw)),
    protein: roundToDigits(Number(n['proteins_100g']) || 0, 1),
    fat: roundToDigits(Number(n['fat_100g']) || 0, 1),
    carbs: roundToDigits(Number(n['carbohydrates_100g']) || 0, 1),
    source: 'openfoodfacts'
  };
}

function roundToDigits(value, digits) {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

// ============================================================
// Google Gemini API（食事写真からのカロリー・PFC推定）
// ============================================================
//
// APIキーはユーザー自身がGoogle AI Studioで取得し、設定画面から登録する。
// キーは端末のlocalStorageにのみ保存され、画像は解析実行時にGoogleのAPIへ
// 直接送信される（このアプリ独自のサーバーは存在しないため、他へは送信されない）。

const GEMINI_API_KEY_STORAGE = 'dietapp_gemini_api_key';
const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_TIMEOUT_MS = 30000;

function getGeminiApiKey() {
  return localStorage.getItem(GEMINI_API_KEY_STORAGE) || '';
}

function saveGeminiApiKey(key) {
  if (key) {
    localStorage.setItem(GEMINI_API_KEY_STORAGE, key);
  } else {
    localStorage.removeItem(GEMINI_API_KEY_STORAGE);
  }
}

/**
 * 画像ファイルを解析用に縮小し、Gemini APIへ渡せるbase64形式に変換する。
 * スマートフォンの写真は非常に大きいことが多いため、長辺1024pxに縮小して
 * 通信量を減らし、解析の安定性を高める。
 * @param {File} file 選択された画像ファイル
 * @returns {Promise<{base64: string, mimeType: string, previewUrl: string}>}
 */
function resizeImageForAnalysis(file, maxDim = 1024, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
      img.onload = () => {
        let width = img.naturalWidth;
        let height = img.naturalHeight;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg', previewUrl: dataUrl });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 食事の写真をGemini APIに送信し、写っている料理ごとの推定量とカロリー・PFCを取得する。
 * 失敗時(APIキー未設定・通信エラー・認識失敗など)は分かりやすいメッセージのErrorをthrowする。
 * 呼び出し側でtry/catchし、ユーザーに通知した上で手動記録にフォールバックできるようにすること。
 * @param {string} base64Data Base64エンコードされた画像データ（data:...の接頭辞なし）
 * @param {string} mimeType 画像のMIMEタイプ（例: image/jpeg）
 * @returns {Promise<Array<{name:string, amount:number, kcal:number, protein:number, fat:number, carbs:number}>>}
 */
async function analyzeMealPhoto(base64Data, mimeType) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('APIキーが設定されていません。設定画面でGoogle Gemini APIキーを登録してください。');
  }

  const promptText =
    'この食事の写真に写っている料理をすべて識別してください。' +
    'それぞれについて、日本語の料理名・写真から推定できる分量(グラム)・' +
    'その分量に対する実際の推定カロリー(kcal)・タンパク質(g)・脂質(g)・炭水化物(g)を出力してください。' +
    '100gあたりの値ではなく、写っている量に対する実際の値を出力してください。' +
    '複数の料理が写っている場合はすべて列挙してください。';

  const requestBody = {
    contents: [{
      parts: [
        { text: promptText },
        { inlineData: { mimeType: mimeType, data: base64Data } }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                amount_g: { type: 'NUMBER' },
                kcal: { type: 'NUMBER' },
                protein: { type: 'NUMBER' },
                fat: { type: 'NUMBER' },
                carbs: { type: 'NUMBER' }
              },
              required: ['name', 'amount_g', 'kcal', 'protein', 'fat', 'carbs']
            }
          }
        },
        required: ['items']
      }
    }
  };

  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
  } catch (networkError) {
    throw new Error('AI解析サーバーへの通信に失敗しました。ネットワーク接続を確認してください。');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const errJson = await response.json();
      detail = (errJson && errJson.error && errJson.error.message) || '';
    } catch (e) { /* 詳細取得失敗時は無視 */ }

    if (response.status === 400 || response.status === 403) {
      throw new Error('APIキーが正しくないか、権限がありません。設定画面のAPIキーをご確認ください。' + (detail ? '(' + detail + ')' : ''));
    }
    if (response.status === 429) {
      throw new Error('APIの利用上限に達しました。しばらく待ってから再度お試しください。');
    }
    throw new Error('AI解析に失敗しました。' + (detail || ('status: ' + response.status)));
  }

  const data = await response.json();
  const candidate = data && data.candidates && data.candidates[0];
  if (!candidate || (candidate.finishReason && candidate.finishReason !== 'STOP')) {
    throw new Error('写真を解析できませんでした。別の写真でお試しください。');
  }

  const text = candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;
  if (!text) {
    throw new Error('AIから解析結果を取得できませんでした。別の写真でお試しください。');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('AIの応答を解析できませんでした。');
  }

  if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error('写真から料理を認識できませんでした。別の写真でお試しください。');
  }

  return parsed.items.map(item => ({
    name: String(item.name || '不明な料理').trim().slice(0, 40) || '不明な料理',
    amount: roundToDigits(Number(item.amount_g) || 100, 0),
    kcal: roundToDigits(Number(item.kcal) || 0, 1),
    protein: roundToDigits(Number(item.protein) || 0, 1),
    fat: roundToDigits(Number(item.fat) || 0, 1),
    carbs: roundToDigits(Number(item.carbs) || 0, 1)
  }));
}
