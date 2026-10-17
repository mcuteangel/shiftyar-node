import pathlib
d = pathlib.Path(__file__).parent
s = (d/'shell.html').read_text(encoding='utf-8')
s = s.replace('/*STYLE*/', (d/'style.css').read_text(encoding='utf-8'))
s = s.replace('/*CORE*/', (d/'core.js').read_text(encoding='utf-8'))
s = s.replace('/*UI*/', (d/'ui.js').read_text(encoding='utf-8'))
(d/'shiftyar.html').write_text(s, encoding='utf-8')
print(len(s.encode('utf-8')), 'bytes')
