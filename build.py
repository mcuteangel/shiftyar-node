"""ساخت نسخهٔ تک‌فایل (برای باز کردن مستقیم یا انتشار به‌صورت Artifact) از فایل‌های web/"""
import pathlib
root = pathlib.Path(__file__).parent
web = root / 'web'
s = (web / 'shell.html').read_text(encoding='utf-8')
s = s.replace('/*STYLE*/', (web / 'style.css').read_text(encoding='utf-8'))
s = s.replace('/*CORE*/', (web / 'core.js').read_text(encoding='utf-8'))
s = s.replace('/*EXPORT*/', (web / 'export.js').read_text(encoding='utf-8'))
s = s.replace('/*UI*/', (web / 'ui.js').read_text(encoding='utf-8'))
(root / 'shiftyar.html').write_text(s, encoding='utf-8')
print(len(s.encode('utf-8')), 'bytes')
