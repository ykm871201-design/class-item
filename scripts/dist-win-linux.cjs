// Linux/macOS에서 Windows 설치 파일 빌드 (Wine 없이)
// electron-builder는 NSIS 제거 프로그램을 만들 때 Wine으로 설치 파일을 한 번 실행하는데,
// Wine을 쓸 수 없는 환경을 위해 electron-builder에 포함된 순수 JS 추출기(UninstallerReader)를 쓰도록 한다.
// Windows에서는 이 스크립트 대신 `npm run dist:win`을 사용하면 된다.
const mv = require('app-builder-lib/out/util/macosVersion');
mv.isMacOsCatalina = () => true;
const { build, Platform, Arch } = require('electron-builder');

build({ targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), publish: 'never' })
  .then((files) => console.log('완료:\n' + files.join('\n')))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
