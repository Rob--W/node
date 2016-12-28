'use strict'
var path = require('path')
var iferr = require('iferr')
var asyncMap = require('slide').asyncMap
var fs = require('graceful-fs')
var rename = require('../../utils/rename.js')
var gentlyRm = require('../../utils/gently-rm.js')
var updatePackageJson = require('../update-package-json')
var npm = require('../../npm.js')
var moduleName = require('../../utils/module-name.js')
var packageId = require('../../utils/package-id.js')
var cache = require('../../cache.js')
var moduleStagingPath = require('../module-staging-path.js')

module.exports = function (staging, pkg, log, next) {
  log.silly('extract', packageId(pkg))
  var up = npm.config.get('unsafe-perm')
  var user = up ? null : npm.config.get('user')
  var group = up ? null : npm.config.get('group')
  var extractTo = moduleStagingPath(staging, pkg)
  cache.unpack(pkg.package.name, pkg.package.version, extractTo, null, null, user, group,
        andUpdatePackageJson(pkg, staging, extractTo, andStageBundledChildren(pkg, staging, extractTo, log, next)))
}

function andUpdatePackageJson (pkg, staging, extractTo, next) {
  return iferr(next, function () {
    updatePackageJson(pkg, extractTo, next)
  })
}

function andStageBundledChildren (pkg, staging, extractTo, log, next) {
  return iferr(next, function () {
    for (var i = 0; i < pkg.children.length; ++i) {
      var c = pkg.children[i]
      if (!c.package.name) return next(c.error)
    }

    asyncMap(pkg.children, andStageBundledModule(pkg, staging, extractTo), cleanupBundled)
  })
  function cleanupBundled () {
    gentlyRm(path.join(extractTo, 'node_modules'), next)
  }
}

function andStageBundledModule (bundler, staging, parentPath) {
  return function (child, next) {
    stageBundledModule(bundler, child, staging, parentPath, next)
  }
}

function getTree (pkg) {
  while (pkg.parent) pkg = pkg.parent
  return pkg
}

function warn (pkg, code, msg) {
  var tree = getTree(pkg)
  var err = new Error(msg)
  err.code = code
  tree.warnings.push(err)
}

function stageBundledModule (bundler, child, staging, parentPath, next) {
  var stageFrom = path.join(parentPath, 'node_modules', child.package.name)
  var stageTo = moduleStagingPath(staging, child)

  asyncMap(child.children, andStageBundledModule(bundler, staging, stageFrom), iferr(next, moveModule))

  function moveModule () {
    if (child.fromBundle) {
      return rename(stageFrom, stageTo, iferr(next, updateMovedPackageJson))
    } else {
      return fs.stat(stageFrom, function (notExists, exists) {
        if (exists) {
          warn(bundler, 'EBUNDLEOVERRIDE', 'In ' + packageId(bundler) +
            ' replacing bundled version of ' + moduleName(child) +
            ' with ' + packageId(child))
          return gentlyRm(stageFrom, next)
        } else {
          return next()
        }
      })
    }
  }

  function updateMovedPackageJson () {
    updatePackageJson(child, stageTo, next)
  }
}