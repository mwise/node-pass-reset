/**
 * Password reset module
 *
 * @author Mark Wise
 * @author originally by James Brumond
 */

var util = require("util")
  , json = require("json-output")
  , async = require("async")
  , storage = require("./storage")

/**
 * Expose storage interface
 */
exports.storage = storage
storage.setStore(new storage.MemoryStore())

/**
 * Set the expire timeout
 *
 * Defaults to 43200000, or 12 hours
 */
var timeoutUnits = {
  sec:   1000,
  secs:  1000,
  min:   1000 * 60,
  mins:  1000 * 60,
  hour:  1000 * 60 * 60,
  hours: 1000 * 60 * 60,
  day:   1000 * 60 * 60 * 24,
  days:  1000 * 60 * 60 * 24,
  week:  1000 * 60 * 60 * 24 * 7,
  weeks: 1000 * 60 * 60 * 24 * 7
}

var expireTimeout = 43200000

exports.expireTimeout = function(num, unit){
  if (typeof num === "number" && ! isNaN(num)) {
    var multiplier = 1
    if (unit && timeoutUnits.hasOwnProperty(unit)) {
      multiplier = timeoutUnits[unit]
    }
    expireTimeout = num * multiplier
  }
  return expireTimeout
}

/**
 * User lookup routine
 *
 * Should result in an array of objects containing a unique id and email.
 */
var lookupUsers = function(login, callback){
  callback(null, null)
}

exports.lookupUsers = function(func){
  if (typeof func === "function") {
    lookupUsers = func
  }
}

/**
 * Password setting routine
 *
 * Should take a unique id (as returned from the user lookup
 * routine) and a new password.
 */
var setPassword = function(id, password, callback){
  callback(null, false, null)
}

exports.setPassword = function(func){
  if (typeof func === "function") {
    setPassword = func
  }
}

/**
 * Email sending routine
 *
 * Should take an email address and tokens.
 */
var sendEmail = function(email, resets, callback){
  callback(null, false)
}

exports.sendEmail = function(func){
  if (typeof func === "function") {
    sendEmail = func
  }
}

/**
 * The route that takes reset requests
 *
 * eg. POST /password/reset
 */
exports.requestResetToken = function(opts){

  opts = merge({
    next: null,
    error: "json",
    loginParam: "login",
    callbackURL: "/password/reset/{token}"
  }, opts)

  var func = function(req, res, next){
    var sendJson = json.respondTo(res)

    var login = req.body ? req.body[opts.loginParam] : null
    if (! login) {
      return handleError(req, res, "Please specify an email address.", 400)
    }

    lookupUsers(login, function(err, theUsers){
      if (err) {
        return handleError(req, res, err.message, 500)
      }
      if (! theUsers) {
        return handleError(req, res, "D'oh! No user found for that email.", 404)
      }
      async.map(theUsers.users,
        function(user, callback){
          storage.create(user.id, function(err, token){
            if (err) {
              return callback(err)
            }
            var url = "http://" + req.headers.host + opts.callbackURL.replace("{token}", token)
            callback(null, {
              token: token,
              name: user.name,
              url: url
            })
          })
        },
        function(err, users){
          if (err) {
            return handleError(req, res, err.message, 500)
          }
          sendEmail(theUsers.email, users, function(err, sent){
            if (err) {
              return handleError(req, res, err.message, 500)
            }
            if (! opts.next) {
              return sendJson({ status: "OK" })
            }
            if (typeof opts.next === "string") {
              res.redirect(opts.next)
            } else if (typeof opts.next === "function") {
              opts.next(req, res, next)
            } else {
              next()
            }
          })
        })
    })
  }
  func._opts = opts
  return func
}

/**
 * The route that actually does resets
 *
 * eg. PUT /password/reset
 */
exports.resetPassword = function(opts){
  opts = merge({
    next: null,
    tokenParam: "token",
    passwordParam: "password",
    confirmParam: "confirm"
  }, opts)

  var func = function(req, res, next){
    var sendJson = json.respondTo(res)

    var params = req.body ? {
      token: req.body[opts.tokenParam],
      password: req.body[opts.passwordParam],
      confirm: req.body[opts.confirmParam]
    } : { }
    if (! params.token || ! params.password || ! params.confirm) {
      return handleError(req, res, "Please ensure both fields are filled in", 400)
    }
    storage.lookup(params.token, function(err, id){
      if (err) {
        return handleError(req, res, err.message, 500)
      }
      if (! id) {
        return handleError(req, res, "Request token is invalid", 401)
      }
      if (params.password !== params.confirm) {
        return handleError(req, res, "Password and confirmation do not match", 400)
      }
      setPassword(id, params.password,
        function(err, success, validationError){
          if (err) {
            return handleError(req, res, err.message, 500)
          }
          if (! success) {
            return handleError(req, res, validationError, 400)
          }
          storage.destroy(params.token)
          if (! opts.next) {
            return sendJson({ status: "OK" })
          }
          if (typeof opts.next === "string") {
            res.redirect(opts.next)
          } else if (typeof opts.next === "function") {
            opts.next(req, res, next)
          } else {
            next()
          }
        }
      )
    })
  }
  func._opts = opts
  return func
}

// ------------------------------------------------------------------
//  Utilities

function merge(host){
  host = isMutable(host) ? host : { }
  Array.prototype.slice.call(arguments, 1).forEach(function(arg){
    if (isMutable(arg)) {
      Object.keys(arg).forEach(function(prop){
        host[prop] = arg[prop]
      })
    }
  })
  return host
}

function isMutable(value){
  return (typeof value === "object" && value) || typeof value === "function"
}

function handleError(req, res, msg, errStatus, redirectUrl){
  redirectUrl = redirectUrl || req.headers.referer || "/"

  if (req.xhr) {
    var sendJson = json.respondTo(res)
    sendJson.error(msg, errStatus)
  } else {
    req.flash("errors", [msg])
    res.redirect(redirectUrl)
  }
}
