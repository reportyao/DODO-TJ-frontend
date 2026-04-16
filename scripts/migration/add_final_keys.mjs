import fs from 'fs';

// Read existing translation files
const zhPath = './src/i18n/locales/zh.json';
const ruPath = './src/i18n/locales/ru.json';
const tgPath = './src/i18n/locales/tg.json';

const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
const ru = JSON.parse(fs.readFileSync(ruPath, 'utf8'));
const tg = JSON.parse(fs.readFileSync(tgPath, 'utf8'));

// Add missing keys
const newKeys = {
  common: {
    user: { zh: '用户', ru: 'Пользователь', tg: 'Корбар' },
    aUser: { zh: '一位用户', ru: 'Один пользователь', tg: 'Як корбар' }
  },
  lottery: {
    insufficientBalance: { 
      zh: '幸运币余额不足，需要 {{required}} 幸运币，当前余额 {{current}} 幸运币',
      ru: 'Недостаточно счастливых монет, требуется {{required}}, текущий баланс {{current}}',
      tg: 'Сикка ҳои хушбахтӣ кофӣ нест, зарур аст {{required}}, мавҷуда {{current}}'
    },
    winningCodeCopied: {
      zh: '中奖码已复制',
      ru: 'Выигрышный код скопирован',
      tg: 'Рамзи бурдан нусхабардорӣ шуд'
    }
  },
  market: {
    unknownItem: { zh: '未知商品', ru: 'Неизвестный товар', tg: 'Мол номаълум' },
    createFailed: { zh: '发布转售失败', ru: 'Не удалось опубликовать перепродажу', tg: 'Нашр кардани дубора фурӯшӣ қобил нашуд' }
  },
  showoff: {
    prizeNotFound: { zh: '未找到选中的中奖记录', ru: 'Запись о выигрыше не найдена', tg: 'Сабти бурди интихобшуда ёфт нашуд' }
  },
  dev: {
    confirmClearUser: { 
      zh: '确定要清除当前测试用户吗?',
      ru: 'Вы уверены, что хотите удалить текущего тестового пользователя?',
      tg: 'Шумо мутмаин ҳастед, ки мехоҳед корбари санҷиширо нест кунед?'
    }
  }
};

// Merge new keys
function mergeKeys(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (!target[key]) {
      target[key] = {};
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      mergeKeys(target[key], value);
    } else {
      target[key] = value;
    }
  }
}

// Add Chinese keys
for (const [section, keys] of Object.entries(newKeys)) {
  if (!zh[section]) {zh[section] = {};}
  for (const [key, translations] of Object.entries(keys)) {
    zh[section][key] = translations.zh;
  }
}

// Add Russian keys
for (const [section, keys] of Object.entries(newKeys)) {
  if (!ru[section]) {ru[section] = {};}
  for (const [key, translations] of Object.entries(keys)) {
    ru[section][key] = translations.ru;
  }
}

// Add Tajik keys
for (const [section, keys] of Object.entries(newKeys)) {
  if (!tg[section]) {tg[section] = {};}
  for (const [key, translations] of Object.entries(keys)) {
    tg[section][key] = translations.tg;
  }
}

// Write back to files
fs.writeFileSync(zhPath, JSON.stringify(zh, null, 2), 'utf8');
fs.writeFileSync(ruPath, JSON.stringify(ru, null, 2), 'utf8');
fs.writeFileSync(tgPath, JSON.stringify(tg, null, 2), 'utf8');

console.log('✅ Final translation keys added successfully!');
console.log('Added keys:', Object.keys(newKeys));
