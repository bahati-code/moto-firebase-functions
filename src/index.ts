"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
const functions = require("firebase-functions");
const util = require("util");
// const orderManagement = require("./createOrder");
const ALLOWED_ORIGINS = ["http://motonetwork.io", "http://localhost:4200"];

const runtimeOpts = {
  timeoutSeconds: 300,
  memory: "1GB",
};

/**
 * cors shit
 * @param {any} request firebase request object
 * @param {any} response firebase resonse object
 * @param {any} callback the function
 * @return {any} callback

 */
function setCorsHeaders(request: any, response: any, callback: any) {
  const originUrl = "*";
  console.log("setCorsHeader");
  if (ALLOWED_ORIGINS.includes(request.headers.origin)) {
    // originUrl = request.headers.origin;

  }

  response.set("Access-Control-Allow-Origin", originUrl);
  response.set("Access-Control-Allow-Credentials", "true");

  if (request.method === "OPTIONS") {
    // Send response to OPTIONS requests
    response.set("Access-Control-Allow-Methods", "GET,POST");
    response.set("Access-Control-Allow-Headers", "*");
    response.set("Access-Control-Max-Age", "3600");
    response.status(204).send("");
  }

  return callback(request, response);
}

/**
 * log errors
 * @param {string} errorName name of the error
 * @param {string} information  information
 * @param {any}details error details json object
 */
export function logError(errorName: string, information: string, details?: any): void {
  const line: string = "===================ERROR===================";
  console.log(line);
  console.group(errorName);
  console.log(information);
  if (details) {
    console.log("details :");
    console.table(util.inspect(details, {showHidden: false, depth: null}));
  }
  console.groupEnd();
}

/**
 * how some info for the logs
 * @param {string} name
 * @param {object}details
 */
export function logInfo(name: string, details?: any): void {
  const line: string = "*********************INFO**************************";
  console.log(line);
  console.group(name);
  if (details) {
    console.log("details :");
    console.table(util.inspect(details, {showHidden: false, depth: null}));
  }
  console.groupEnd();
}

exports.uploadNFT = functions.runWith(runtimeOpts).https.onRequest(async (request: any, response: any) => {
//  return setCorsHeaders(request, response, uploadNFT);
  import("./uploadNFT")
      .then((mod) => {
        if (mod) {
          setCorsHeaders(request, response, mod.uploadNFT);
        }
      });
});

exports.orderCreated = functions.https.onRequest(async (request: any, response: any) => {
  import("./createOrder")
      .then((mod) => {
        if (mod) {
          setCorsHeaders(request, response, mod.orderCreated);
        }
      });
  // return setCorsHeaders(request, response, orderManagement.orderCreated);

  // await setCorsHeaders(request, response, (await import("./createOrder")).orderCreated(request, response));
});
