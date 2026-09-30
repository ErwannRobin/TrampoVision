import type { Translation } from '..';
import type { twist as en } from '../en/twist';

export const twist: Translation<typeof en> = {
  'twist.title': 'ひねり',
  'twist.experimental': '試験的',
  'twist.noWorld': 'この解析には3D姿勢データがないため、測定できるひねりがありません。',
  'twist.noJump': 'ジャンプが見つからないため、測定できるひねりがありません。',
  'twist.cameraLimits': '1台のカメラではひねりについて決して分からないこと',
  'twist.notMeasured': 'ひねり：未測定',
  'twist.notReliable': 'ひねり：信頼できません',
  'twist.unit': { one: 'ひねり', other: 'ひねり' },
  'twist.halfUnit': { one: '半ひねり', other: '半ひねり' },
  'twist.consistency': '整合性',
  'twist.belowMin': '{min}未満',
  'twist.consistencyLabel': 'ひねりの整合性',
  'twist.rawCaution': '下の生の値は確認用にのみ表示しています。測定値として読まないでください。',
  'twist.consistencyNote':
    '整合性 = 3Dデータどうしがどれだけ一致しているか（下のチェックを掛け合わせたもの）です。正しさの確率ではなく、まだ実際のひねりとは比較されていません。比較するには、下部の注釈を使ってください。',
  'twist.measured': '測定値',
  'twist.raw': '生の値（信頼できません）',
  'twist.sameRoutes': '別の方法で求めた同じひねり',
  'twist.checksBehind': '整合性の根拠となるチェック',
  'twist.weakCount': '弱い項目 {n}件',
  'twist.weak': '弱い',
  'twist.noProblem':
    'このジャンプにデータ上の問題は見つかりませんでした。ただし、ひねりが正しい証拠ではありません（下記参照）。',
  'twist.couldNotSettle': '3Dデータでは判断できなかったこと',
  'twist.checkAgainst': 'あなたの数え方と照合',
  'twist.countLabel': 'このジャンプで数えた半ひねりの数',
  'twist.cannotSave': 'このジャンプは現在データセットに保存できないため、数えることができません。',
  'twist.notCounted': '未入力',
  'twist.youCounted': 'あなたの数',
  'twist.estimate': '推定値',
  'twist.same': '一致',
  'twist.different': '不一致',
  'twist.flagged': '推定値は信頼できないとされています。',
  'twist.annotationNote':
    'ジャンプとともにデータセットに保存され、実際のジャンプでひねりの推定を採点できるようになります。半ひねりは、このツールではなく動画から数えてください。',
  'twist.sinceTakeoff': '踏み切りからのひねり（現在）',
  'twist.speedNow': 'ひねりの速さ（現在）',
  'twist.option': { one: '{v}（= {twists}回ひねり）', other: '{v}（= {twists}回ひねり）' },
  'twist.readiness': 'このブラウザーの3D対応状況',
  'twist.checking': '確認中…',
  'twist.modelInUse': '使用中のモデル。',
  'twist.separateModel': '別の3Dモデル。',
  'twist.mediapipeNote':
    'MediaPipe Tasks Vision は WebGL（「GPU」）または WebAssembly（「CPU」）で動作します。WebGPU は使いません。',

  'twist.check.rounding': '半ひねりの整数値に近い',
  'twist.check.coverage': '肩と腰が3Dで検出されている',
  'twist.check.steps': 'フレーム間の飛びがない（左右の入れ替わり）',
  'twist.check.monotonic': '一方向にのみ回転している',
  'twist.check.shoulderHip': '肩と腰が一致している',
  'twist.check.axisDepth': '軸を画像平面内に保っても同じ結果',
  'twist.check.depth': '3Dの肩幅が一定',

  'twist.dir.none': 'なし',
  'twist.dir.positive': '反時計回り',
  'twist.dir.negative': '時計回り',
  'twist.row.net': '正味のひねり（踏み切りから着地）',
  'twist.row.halves': '推定した半ひねり',
  'twist.row.direction': '方向',
  'twist.row.directionHint': '頭の上から見て：+ は反時計回り、− は時計回りです。',
  'twist.row.peak': 'ひねりの最大速度',
  'twist.row.mean': 'ひねりの平均速度',
  'twist.row.tilt': '体幹軸の画像平面からのずれ',
  'twist.row.onAverage': '平均',
  'twist.row.shoulders': '肩のラインのみ',
  'twist.row.hips': '腰のラインのみ',
  'twist.row.plane': '画像平面内に保った軸',
  'twist.cap.webgpuNoAdapter': 'APIはあるがGPUアダプターなし',
  'twist.cap.threadsNo': 'いいえ（cross-origin isolated ではありません）',
  'twist.cap.cpu': 'CPUコア数 / メモリ',
  'twist.cap.wasm': 'WebAssembly / SIMD',
  'twist.cap.threads': 'WASMスレッド',

  'twist.limit.depth.signal': '奥行きは推測',
  'twist.limit.depth.problem':
    '3D姿勢は1枚の画像から作られます。ひねりは体の軸まわりの肩のラインの回転ですが、横から見るとそのラインはカメラの方を向くため、モデルがどちらの肩を手前に置くかだけから読み取ります。',
  'twist.limit.depth.needed': '2台目のカメラ、または深度センサー。',
  'twist.limit.error.signal': '小さな奥行きの誤差が大きなひねりになる',
  'twist.limit.error.problem':
    '実際のモデル出力（画像平面内で回転させた静止写真）で測定：モデルが体幹を平面から15°傾け、1回の宙返りの間に−94°の架空のひねりが生じました。「画像平面内の軸」のチェックだけがこれを検出しました。',
  'twist.limit.error.needed': '測定した奥行き。',
  'twist.limit.swap.signal': '左右が入れ替わることがある',
  'twist.limit.swap.problem':
    'モデルが左右の肩を入れ替えると、ひねりが2フレームの間に180°跳びます。{max}°を超える変化は折り返して数えるため、半ひねりの数が1つずれることがあります。',
  'twist.limit.swap.needed': '左右を安定して保つ姿勢モデル、またはより高いフレームレート。',
  'twist.limit.rate.signal': 'フレームレートが速度を制限する',
  'twist.limit.rate.problem':
    '{fps} fps では、{rate} °/s（毎秒{perSecond}回転）より速いひねりは入れ替わりと区別できません。',
  'twist.limit.validated.signal': '実際にひねる選手では未検証',
  'twist.limit.validated.problem':
    '推定器は、シミュレーションした3D選手では正確で、1枚の静止写真で架空のひねりを確認しました。ひねりを行うトランポリン選手ではテストしていません。符号（+ = 頭の上から見て反時計回り）は、その写真でのモデルの軸と一致するだけです。',

  'tw.signal.twist': 'ひねり',
  'tw.signal.pose3d': '3D姿勢',
  'tw.no3d.problem':
    'この解析には3Dのランドマークがありません（3D対応前に保存したデータ、または2Dのみの姿勢バックエンド）。',
  'tw.no3d.needed': 'フレームごとに3Dランドマークを返す MediaPipe バックエンドで、動画を再解析してください。',
  'tw.cutOff.problem':
    'このジャンプはクリップの始めまたは終わりで途切れているため、踏み切りから着地までのひねりを合計できません。',
  'tw.cutOff.needed': '滞空全体が映っているクリップ。',
  'tw.notFound.problem': 'この滞空中、肩と腰を3Dで検出できませんでした。',
  'tw.notFound.needed': '選手が姿勢モデルにとって十分な大きさで映っているクリップ。',
  'tw.torsoUnknown.problem': '踏み切りまたは着地の時点で体幹が分からないため、正味のひねりを計算できません。',
  'tw.torsoUnknown.needed': '両方の時点で肩と腰が見えていること。',
  'tw.coverage.signal': '3D体幹のカバー率',
  'tw.coverage.problem': '肩と腰を測定できたのは滞空の {share} だけで、残りは補間または欠損です。',
  'tw.coverage.needed': '滞空全体を通して体幹がより鮮明に見えること。',
  'tw.axis.signal': '軸の奥行き',
  'tw.axis.problem':
    'ひねりは、体幹の軸が画像平面からどれだけ傾くかに依存します：3D軸では {total}、画像平面内に保った軸では {plane}。一定のわずかな奥行きの誤差が、宙返りを架空のひねりに変えてしまいます。',
  'tw.axis.needed': '1台のカメラのモデルによる推測ではなく、測定した奥行き（2台目のカメラまたは深度センサー）。',
  'tw.shoulderHip.signal': '肩と腰の比較',
  'tw.shoulderHip.problem':
    '肩のラインは {shoulders}、腰のラインは {hips} を示しています。滞空全体では両方が一緒に回るはずです。',
  'tw.shoulderHip.needed': 'より信頼できる肩と腰のランドマーク（どちらも推定であり、測定ではありません）。',
  'tw.depth.signal': '奥行きの一貫性',
  'tw.depth.problem':
    '3Dの肩幅が滞空中に {cv} 変動しています。剛体なら一定のはずなので、奥行きの値にノイズがあります。',
  'tw.depth.needed': 'より良い奥行き：2台目のカメラ、または空中の選手向けに学習したモデル。',
  'tw.swaps.signal': '左右の入れ替わり',
  'tw.swaps.problem': {
    one: '2フレーム間で{max}°を超える変化が{n}回（最大 {largest}）あり、左右の入れ替わりとして折り返しました。半ひねりの数が1つずれることがあります。',
    other:
      '2フレーム間で{max}°を超える変化が{n}回（最大 {largest}）あり、左右の入れ替わりとして折り返しました。半ひねりの数が1つずれることがあります。',
  },
  'tw.swaps.needed': '高いフレームレート、または選手が回転しても左右を安定して保つ姿勢モデル。',
  'tw.rate.signal': 'フレームレート',
  'tw.rate.problem':
    '2フレーム間の最大のひねりの変化は {largest} です。{max}°を超えると、ひねりと入れ替わりを区別できません。',
  'tw.rate.needed': '高いフレームレート。',
  'tw.direction.signal': 'ひねりの方向',
  'tw.direction.problem':
    '累積したひねりが一方向に進んだ後、{reversal} 戻りました。本当のひねりは一方向に回り続けるため、姿勢モデルが体を反転させた可能性が高いです。',
  'tw.direction.needed': 'より安定した姿勢推定。',
  'tw.rounding.signal': '丸め',
  'tw.rounding.problem': '{total} は、半ひねりの整数値から {off} ずれています。',
  'tw.rounding.needed': 'よりきれいな推定。着地時の本当のひねりは180°の倍数です。',
  'tw.side.signal': '横からの視点',
  'tw.side.problem':
    '滞空の {share} で、肩のラインが視線方向を向いています。この場合、ひねりはどちらの肩がカメラに近いかとしてしか現れず、1台のカメラのモデルにとって最も弱い信号です。',
  'tw.side.needed': '2台目のカメラ、または正面か背面からの映像。',

  'cap.runtime.webgl': 'WebGL（GPUデリゲート）',
  'cap.runtime.wasm': 'WebAssembly（CPUデリゲート）',
  'cap.runtime.none': '対応するランタイムなし',
  'cap.current.ok':
    '利用可能。MediaPipe の姿勢モデルはすでにフレームごとに3Dランドマーク（BlazePose GHUM、単位はメートル）を返すため、2つ目のモデルは読み込みません。{runtime} で動作します。',
  'cap.current.okSimd':
    '利用可能。MediaPipe の姿勢モデルはすでにフレームごとに3Dランドマーク（BlazePose GHUM、単位はメートル）を返すため、2つ目のモデルは読み込みません。{runtime} で動作します（WASM SIMD 有効）。',
  'cap.current.none':
    'この解析には3Dのランドマークがありません（3D対応前に保存したデータ）。動画を再解析してください。',
  'cap.dedicated.webgpu':
    '専用の3Dモデルなら、このブラウザーで WebGPU（onnxruntime-web 経由）上で動かせる可能性があります。未実装です。モデルファイルが必要で、私はまだどれも試していません。',
  'cap.dedicated.noAdapterThreads':
    'WebGPU はありますが GPU アダプターがないため、専用の3Dモデルはスレッド付きの WebAssembly にフォールバックします。未実装・未検証です。',
  'cap.dedicated.noAdapterSingle':
    'WebGPU はありますが GPU アダプターがないため、専用の3Dモデルはスレッドなしの WebAssembly（このページは cross-origin isolated ではありません）にフォールバックし、低速です。未実装・未検証です。',
  'cap.dedicated.noWebgpuThreads':
    'WebGPU は利用できないため、専用の3Dモデルはスレッド付きの WebAssembly にフォールバックします。未実装・未検証です。',
  'cap.dedicated.noWebgpuSingle':
    'WebGPU は利用できないため、専用の3Dモデルはスレッドなしの WebAssembly（このページは cross-origin isolated ではありません）にフォールバックし、低速です。未実装・未検証です。',
  'cap.dedicated.none': 'WebGPU も WebAssembly も利用できないため、ここでは3Dモデルを実行できません。',

  'p3d.camera': 'カメラ',
  'p3d.cameraTitle': 'カメラから見た向き：xは右、yは下',
  'p3d.side': '横',
  'p3d.sideTitle': 'カメラのx軸に沿って見た図：モデルが推定した奥行きが分かります',
  'p3d.above': '上',
  'p3d.aboveTitle': '選手の真上から見下ろした図',
  'p3d.canvas': '3Dスケルトン。ドラッグで回転できます。',
  'p3d.notReliable': 'ここではひねりを信頼できません',
  'p3d.howToRead': 'この表示の見方',
  'p3d.legend':
    '青 = 左、オレンジ = 右。琥珀色の破線 = 長軸（腰から肩）。濃い点 = 胸の向き。リングは軸に垂直な平面です。灰色 = 踏み切り時に肩のラインが向いていた方向、琥珀色の弧 = そこからのひねり。ドラッグで回転できます。',
  'p3d.legendNow':
    '青 = 左、オレンジ = 右。琥珀色の破線 = 長軸（腰から肩）。濃い点 = 胸の向き。リングは軸に垂直な平面です。灰色 = 踏み切り時に肩のラインが向いていた方向、琥珀色の弧 = そこからのひねり（現在 {now}°）。ドラッグで回転できます。',
  'p3d.pointOfView': '視点',
  'p3d.cancelSide': '並べて書き出しを中止 {percent}',
  'p3d.cancel3d': '3D動画を中止 {percent}',
  'p3d.download3d': '3Dスケルトンを動画としてダウンロード（映像なし）',
  'p3d.downloadSide': '注釈付き動画とこの3D表示を並べてダウンロード',
  'p3d.noFrame': 'このフレームには3D姿勢がありません',
  'p3d.noLandmarks': 'この解析には3Dのランドマークがありません',
  'p3d.longAxis': '長軸',
  'p3d.chest': '胸',
};
