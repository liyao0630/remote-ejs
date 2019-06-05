const ejs = require('ejs')
const request = require('request')
const fs = require('fs')
const asyncUtil = require('async')
const path = require('path')

const cachedContent = {}
let remoteDataConfig = []
let remoteContents = []
let remoteData = {}
let step = 0
let urls = []

const resolveInclude = ejs['resolveInclude']
ejs['resolveInclude'] = function (name, filename, isDir) {
  if (name.match(/^\/?http/)) {
    urls.push(name)
    filename = name
    name = require.main.filename
  }
  return resolveInclude(name, filename, isDir)
}

ejs['fileLoader'] = function (fileName) {
  if (fileName === require.main.filename) {
    if (step < 1 || (step - 1) === remoteContents.length) {
      step = 0
      remoteContents = []
      return ''
    }
    let ret = remoteContents[step - 1]
    step++
    return ret
  }
  return fs.readFileSync(fileName).toString()
}


let staticData = {}

ejs.compileQkTpl = function compileTpl(QkTpl) {
  return QkTpl.replace(/<!— {{{ 7ktpl start -->(\s+{.*}\s*)+<!— 7ktpl end }}} —>/g, function (reg) {
    let includes = []
    reg.replace(/{.*}/g, function (tplConfig) {
      tplConfig = JSON.parse(tplConfig.trim())
      if (tplConfig.data) {
        Object.assign(staticData, tplConfig.data)
      }
      if (tplConfig.remoteData) {
        remoteDataConfig.push(tplConfig.remoteData)
      }
      if (tplConfig.url.match(/^\/?http/)) {
        includes.push('<%- include /' + tplConfig.url + ' %>')
      } else {
        includes.push('<%- include("' + path.join(__dirname, '../views' + tplConfig.url) + '") %>')
      }
    })
    return includes.join('')
  })
}

ejs.promiseRequest = function (config) {
  return new Promise((resolve, reject) => {
    request({ ...config, json: true }, function (e, r, body) {
      if (e) {
        reject(e)
      }
      resolve(body)
    })
  })
}

ejs.remoteDataRequest = function remoteDataRequest(config) {
  return ejs.promiseRequest(config)
}

ejs.qkRender = async function qkRender(tpl) {
  tpl = ejs.compileQkTpl(tpl)

  if (remoteDataConfig.length) {
    let promiseQueue = remoteDataConfig.map((val) => ejs.remoteDataRequest(val))

    await Promise.all(promiseQueue).then(data => {
      remoteDataConfig.map((val, index) => {
        if (val.toJSON) {
          remoteData[val.name] = JSON.parse(data[index])
        } else {
          remoteData[val.name] = data[index]
        }
      })
    }).catch(error => {
      throw error
    });
  }

  const data = Object.assign({}, staticData, remoteData)
  let options = {}
  let ret = ejs.render(tpl, data, options)
  if (urls.length) {
    urls = urls.filter((value, index, self) => {
      return value.charAt(0) !== '/'
    })
    remoteContents = []
    asyncUtil.eachSeries(urls, function (url, callback) {
      if (typeof cachedContent[url] !== 'undefined') {
        remoteContents.push(cachedContent[url])
        callback()
      } else {
        request.get(url, function (e, r, body) {
          if (e) {
            throw new Error(e)
            return
          }
          remoteContents.push(body)
          cachedContent[url] = body
          callback()
        })
      }
    }, function () {
      step = 1

      const ret = ejs.render(tpl, data, options)
      step = 0
      remoteContents = []
      urls = []
      fs.writeFileSync('./test.html', ret)
    })
  } else {
    fs.writeFileSync('./test.html', ret)
  }
}

ejs.qkRender(`
<html>
  <!— {{{ 7ktpl start -->
    {"url": "/user/server.html", "remoteData": {"name": "server", "url": "https://www.easy-mock.com/mock/5cf500e71a941e4f0d260366/ejs/server_post", "method": "post", "form": {"gid": 592, "rand": 0.8994969433880293}} }
    {"url": "/user/list.html", "remoteData": {"name": "list", "url": "https://www.easy-mock.com/mock/5cf500e71a941e4f0d260366/ejs/get_list", "method": "get"} }
    {"url": "http://www.baidu.com", "data":{"name": "test"}}
  <!— 7ktpl end }}} —>
</html>
  `)