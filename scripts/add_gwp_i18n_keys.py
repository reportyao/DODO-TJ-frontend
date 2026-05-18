#!/usr/bin/env python3
"""
为三个语言文件添加 B2B GWP 相关缺失的 i18n keys
"""
import json
import os

LOCALES_DIR = "/home/ubuntu/DODO-TJ-frontend/src/i18n/locales"

# 需要添加的 keys（每种语言）
NEW_KEYS = {
    "zh": {
        "eligible": "已达标",
        "chooseYourGifts": "选择您的赠品",
        "allGiftsUnlocked": "恭喜！您已解锁所有档位的赠品。",
        "confirmNoGift": "您还有赠品未选择，确定要直接结算吗？",
        "minAmount": "满",
    },
    "ru": {
        "eligible": "Достигнуто",
        "chooseYourGifts": "Выберите ваши подарки",
        "allGiftsUnlocked": "Поздравляем! Вы разблокировали все уровни подарков.",
        "confirmNoGift": "Вы ещё не выбрали подарок. Продолжить оформление?",
        "minAmount": "От",
    },
    "tg": {
        "eligible": "Ба даст омад",
        "chooseYourGifts": "Тӯҳфаҳои худро интихоб кунед",
        "allGiftsUnlocked": "Табрик! Шумо ҳамаи сатҳҳои тӯҳфаро кушодед.",
        "confirmNoGift": "Шумо ҳанӯз тӯҳфа интихоб накардед. Идома диҳед?",
        "minAmount": "Аз",
    },
}

def add_keys_to_locale(lang: str, new_keys: dict):
    filepath = os.path.join(LOCALES_DIR, f"{lang}.json")
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    b2b = data.get("b2b", {})
    added = []
    for key, value in new_keys.items():
        if key not in b2b:
            b2b[key] = value
            added.append(key)
    
    data["b2b"] = b2b
    
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    
    return added

def main():
    for lang, keys in NEW_KEYS.items():
        added = add_keys_to_locale(lang, keys)
        if added:
            print(f"✅ {lang}.json: 添加了 {len(added)} 个 key: {added}")
        else:
            print(f"⏭️  {lang}.json: 所有 key 已存在，无需添加")

if __name__ == "__main__":
    main()
