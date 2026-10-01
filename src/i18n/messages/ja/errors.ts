import type { Translation } from '..';
import type { errors as en } from '../en/errors';

export const errors: Translation<typeof en> = {
  'err.unsupportedVideo':
    'このブラウザーでは動画をデコードできません（iPhoneのHEVC .mov や ProRes がよくある原因です）。MP4（H.264）ファイルをお試しください。',
  'err.loadTimeout':
    '動画の読み込みがタイムアウトしました（readyState {ready}、networkState {network}）。MP4（H.264）ファイルをお試しください。',
  'err.seekTimeout':
    '{time} 秒へのシークが {attempts} 回の試行後にタイムアウトしました（readyState {ready}、networkState {network}、seeking {seeking}、currentTime {current} 秒）。デコーダーが停止しました。iPhoneのHEVC/HDR .mov ファイルは、PCのChromeでよくこうなります。H.264に変換（make convert VIDEO=file.MOV）して .mp4 を開いてください。',
  'err.sampleHttp': 'サンプル動画を読み込めませんでした（HTTP {status}）。',
  'err.ffmpegExit': 'ffmpeg が動画を変換できませんでした（終了コード {code}）。',
  'err.ffmpegNoData': 'ffmpeg が動画データを返しませんでした。',
  'err.exportUnsupported': 'このブラウザーでは動画をエクスポートできません（WebCodecs が利用できません）。',
  'err.exportSurface': 'エクスポート用の描画面を作成できませんでした。',
  'err.exportH264': 'このブラウザーでは H.264 動画をエンコードできません。',
  'err.dimensions': '動画のサイズまたは長さを読み取れませんでした。',
  'err.modelFile':
    'モデルファイル {file} が見つかりません。「npm run fetch-assets」を実行してください（またはアセットホストにアップロードしてください）。',
  'err.notJson': 'このファイルは有効な JSON ではありません。',
  'err.notSeries': 'これは TrampoVision の姿勢時系列ファイルではありません。',
  'err.seriesVersion':
    'サポートされていないファイルバージョンです（{found}）。このアプリはバージョン {expected} を読み込みます。',
  'err.noFrames': 'ファイルにフレームデータがありません。',
  'err.frameLandmarks': '{n} 個のランドマークがないフレームがあります。',
  'err.frame3d': '{n} 個のランドマークがない3Dフレームがあります。',
  'err.notDataset': 'これは TrampoVision のデータセットファイルではありません。',
  'err.datasetVersion':
    'サポートされていないデータセットバージョンです（{found}）。このアプリはバージョン {expected} を読み込みます。',
  'err.noRecords': 'データセットにレコードがありません。',
  'err.badRecord': 'レコード {n} は有効なジャンプレコードではありません。',
  'err.idbRequest': 'IndexedDB のリクエストに失敗しました',
  'err.idbTransaction': 'IndexedDB のトランザクションに失敗しました',
  'err.idbAborted': 'IndexedDB のトランザクションが中断されました',
  'err.idbOpen': 'ローカルデータベースを開けませんでした',
  'err.idbBlocked': 'ローカルデータベースが別のタブによってブロックされています',
  'err.idbMissing': 'このブラウザーでは IndexedDB が利用できません',
  'err.storeWarning':
    'ブラウザーのローカルストレージが利用できません（{message}）。ラベルはこのページを閉じるまでしか保持されません。残すにはデータセットをエクスポートしてください。',
  'err.dbWrite': 'ローカルデータベースに書き込めませんでした：{message}',

  'sync.unavailable': '何もアップロードされません。',
  'sync.off': 'オフ。何もアップロードされません。',
  'sync.idle': '解析待ちです。',
  'sync.sending': '送信中…',
  'sync.sent': { one: '{n}ジャンプを送信しました。', other: '{n}ジャンプを送信しました。' },
  'sync.failed': '確認サービスに接続できませんでした。まもなく再試行します。',
};
