const resedit = require('resedit');
const fs = require('fs');

const exePath = 'dist/usb-remoto.exe';
const iconPath = 'assets/icon.ico';

setTimeout(() => {
  try {
    console.log(`Aplicando ícone ${iconPath} em ${exePath}...`);
    const data = fs.readFileSync(exePath);
    const exe = resedit.NtExecutable.from(data);
    const res = resedit.NtExecutableResource.from(exe);

    const iconFile = resedit.Data.IconFile.from(fs.readFileSync(iconPath));
    resedit.Resource.IconGroupEntry.replaceIconsForResource(
        res.entries, 1, 1033, iconFile.icons.map(item => item.data)
    );
    
    // Define metadata fields
    const vi = resedit.Resource.VersionInfo.createEmpty();
    vi.setFileVersion(3, 0, 0, 0, 1033);
    vi.setStringValues(
        { lang: 1033, codepage: 1200 },
        {
            ProductName: 'USB-Remoto',
            FileDescription: 'USB-Remoto MIDI Bridge',
            CompanyName: 'Fabiano Brandão',
            LegalCopyright: 'Copyright (C) Fabiano Brandão'
        }
    );
    vi.outputToResourceEntries(res.entries);

    res.outputResource(exe);
    const out = exe.generate();
    fs.writeFileSync(exePath, Buffer.from(out));
    console.log('Ícone e metadata aplicados com sucesso!');
  } catch (e) {
    console.error('Erro ao aplicar ícone:', e.message);
  }
}, 2000);
