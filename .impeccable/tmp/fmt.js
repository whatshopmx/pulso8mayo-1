let s = '';
process.stdin.on('data', d => s += d).on('end', () => {
  const f = JSON.parse(s);
  console.log('findings', f.length);
  for (const x of f) {
    const file = x.file.replace(/^.*pulso29[\\/]/, '');
    console.log(x.antipattern, '|', x.severity, '|', file + ':' + x.line, '|', x.snippet);
  }
});
