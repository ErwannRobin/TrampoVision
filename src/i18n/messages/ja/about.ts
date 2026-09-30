import type { Translation } from '..';
import type { about as en } from '../en/about';

export const about: Translation<typeof en> = {
  'about.title': 'TrampoVision について',
  'about.back': '戻る',
  'about.lead':
    'TrampoVision は、トランポリンの動画を見て、各技が何だったか、いくつの価値があるか、何を直すべきかを伝えるプロトタイプです。サーバーもチャットボットも使わず、ブラウザー上で動きます。すべての数値は、コードで確認できる単純な計算から出ています。',

  'about.howTitle': '仕組み',
  'about.howText': '動画から得点まで、すべてお使いの端末の中で行う 7 つのステップです。',
  'about.step1.title': '動画を読み込む',
  'about.step1.text':
    '動画は 1 フレームずつ、毎秒約 30 フレームで読み込まれるため、結果は端末の速さに左右されません。ブラウザーが再生できない動画（たとえば iPhone の HEVC ファイル）は、まず ffmpeg.wasm で H.264 に変換されます。',
  'about.step2.title': '骨格を見つける',
  'about.step2.text':
    'MediaPipe の Pose Landmarker（BlazePose モデル）が、各フレームで体の 33 点を見つけます。可能なら GPU、そうでなければ WebAssembly で CPU を使います。おおよその 3D 座標も返されますが、使うのは試験的なひねりの推定だけです。',
  'about.step3.title': '信号を整える',
  'about.step3.text':
    'モデルが自信を持てない点は除外し、急な飛びは棄却し、0.3 秒までの欠けは放物線でつなぎ、各軌跡は 0.15 秒の局所二次近似でなめらかにします。補った点はそれと分かるように記録され、測定した点ほど確かには見えません。',
  'about.step4.title': '重心を追う',
  'about.step4.text':
    '重心は、体の 14 の部位の加重平均です。その高さの時間変化から各ジャンプが分かります。頂点、そして自由落下（9.81 m/s²）が始まる点と終わる点として見つけた踏み切りと着地です。',
  'about.step5.title': '回転と姿勢を測る',
  'about.step5.text':
    '体幹（腰から肩）の角度は巻き戻されるので、何回転でも数え続けます。空中で最も体が閉じた瞬間の股関節と膝の角度から、伸身、抱え込み、屈伸を判断します。選手が向いている方向から、前宙か後宙かを判断します。',
  'about.step6.title': '技に名前をつける',
  'about.step6.text':
    'ルールベースの分類器が、これらの測定値を FIG の技の表と照らし合わせ、常に最も近い推測を出します。自信のない推測には破線と「?」が付き、ワンタップで確認するまで合計に入りません。あなたの修正は参照例になります。',
  'about.step7.title': '採点する',
  'about.step7.text':
    '難度は、認識した動きに FIG の規則（採点規則 2025-2028、トランポリン、§17.1）を当てはめたものです。テストでは、規則自身の例の表にある 139 の値をすべて再現します。演技点はあくまで提案です。真横からの 1 台のカメラで見える減点（§20.2）だけを数え、角度の基準は推定値で、FIG の審判が採点した映像では調整していません。',

  'about.deviceTitle': '端末の中に残るもの',
  'about.deviceText1':
    '動画はブラウザーの外に出ません。ページは他のサイトへのあらゆる通信を拒否し、本番ビルドにはブラウザー自身が強制する Content-Security-Policy も付いています。',
  'about.deviceText2':
    '保存されるのは数値だけで、ブラウザー（IndexedDB）の中に置かれます。測定値、予測、あなたのラベルが対象で、動画は保存されません。アプリにレビューサービスが設定されている場合は、人が確認できるように、分析したジャンプを送ることができます。送るのは測定値だけで、動画もファイル名も含みません。設定のスイッチで止められます。',

  'about.limitsTitle': 'まだできないこと',
  'about.limit1':
    '実際の選手での精度はまだ分かっていません。テストは模擬の選手で行っており、しきい値と確信度は推定値です。',
  'about.limit2':
    '横から固定した水平なカメラ 1 台が最も適しています。ひねり、開脚、正面から見える動きには、それ以上の情報が必要です。3D のひねり推定は試験的で、信頼できないときは「信頼できません」と表示します。',
  'about.limit3':
    '4 分の 1 回転の技（たとえばコーディ）は技の表にありません。最も近い整数回転の技の名前で呼ばれ、推測として印が付きます。',
  'about.limit4':
    '演技点は提案であり、審判の得点ではありません。足、膝の閉じ、つま先の伸びは「未確認」と表示されます。TrampoVision は FIG の公式ツールではありません。',
  'about.limit5': 'メートルと速さは推定値です。トランポリンのベッドの大きさ、または選手の身長から求めています。',

  'about.inspirationTitle': 'きっかけ',
  'about.inspirationText': 'TrampoVision は、フランスのトランポリンクラブ Paris Trampo 12 に着想を得ています。',
  'about.inspirationLink': 'Paris Trampo 12（ウェブサイト）',

  'about.rulesTitle': '規則',
  'about.rulesText':
    '難度は FIG（国際体操連盟）の採点規則に基づいています。公式の規則とマニュアルは FIG のウェブサイトにあります。',
  'about.rulesLink': 'FIG の規則とマニュアル',

  'about.relatedTitle': '類似のプロジェクトと研究',
  'about.relatedText': '同じ課題に取り組む他の成果です。参考として挙げており、TrampoVision との比較はしていません。',
  'about.related.jstage': 'J-STAGE の論文（2025）',
  'about.related.nii': 'CiNii Research のレコード',
  'about.related.pmc': 'PubMed Central の論文（PMC12473961）',
  'about.related.devpost': 'BounceBoard（Devpost のプロジェクト）',
  'about.external': '別のサイトを開きます',

  'about.codeTitle': 'ソースコード',
  'about.codeText': 'TrampoVision は GitHub で公開しており、テストと、各数値の作り方のメモがあります。',
  'about.codeLink': 'GitHub の TrampoVision',
};
