'use strict'

const { app } = require('electron')
const { join } = require('path')

/** 所有录音文件与元数据的根目录。 */
function recordingsRoot() {
  return join(app.getPath('userData'), 'recordings')
}

/** 录音 id 只允许字母、数字、下划线和连字符，防止路径穿越。 */
function assertRecordingId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`非法录音 id: ${JSON.stringify(id)}`)
  }
  return id
}

function recordingDir(id) {
  return join(recordingsRoot(), assertRecordingId(id))
}

module.exports = { recordingsRoot, recordingDir, assertRecordingId }
