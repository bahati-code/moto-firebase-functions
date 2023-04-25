const Web3 = require("web3");
const admin = require("firebase-admin");
const bucketUrl = "gs://motonetworknft";
const serviceAccount = require("../motonetwork-dd52ce6878e4.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: bucketUrl,
});

const db = admin.firestore();
const Busboy = require("busboy");

import {NFT, getProvider, getContract, Contract, Order} from "./config";
import {logInfo, logError} from "./index";

/**
 * is called from client
 * @param {any} req request object
 * @param {any} res response object
 */
export function orderCreated(req: any, res: any) {
  console.log("function called;");
  let nft: NFT | null = null;

  if (req.method !== "POST") {
    res.writeHead(200, {Connection: "close"});
    res.end();
  }
  const busboy = new Busboy({headers: req.headers});
  req.pipe(busboy);
  busboy.on("field", (fieldname: string, value: string) => {
    if (fieldname == "nft") {
      console.log("found nft");
      nft = JSON.parse(value);
    }
  });
  busboy.on("finish", function() {
    if (nft) {
      console.log("have nft");
      saveLatestOrder(nft)
          .then((order: Order) => {
            if (order) {
              Promise.all([saveOrderToDb(order), updateNFT(order)])
                  .then((results) => {
                    if (results[0] && results[1]) {
                      res.send(order);
                    } else {
                      res.status(500);
                      res.send("something went wrong");
                    }
                  })
                  .catch((error) => {
                    logError("SavelatestOrder", "inside the primise", error);
                    res.send(500).send("something went wrong");
                  });
            } else {
              res.status(200);
              res.send({results: null});
            }
          });
    } else {
      console.log("dont have nft");
    }
  });
  busboy.end(req.rawBody);
}

/**
 * @param {NFT} nft file being sold
 */
async function saveLatestOrder(nft:NFT): Promise<any> {
  return new Promise((resolve, reject) => {
    const motoMarket: Contract = getContract(nft.chainId, "market");
    const web3 = new Web3(getProvider(nft.chainId));
    const marketContract = new web3.eth
        .Contract(motoMarket.abi, motoMarket.address);
    web3.eth.getBlockNumber()
        .then((blockNumber: number) => {
          console.log("blocknumber", blockNumber);
          if (!blockNumber) {
            reject(new Error("unable to connect to contract"));
          }
          const options = {
            filter: {
              assetId: nft.tokenId,
              seller: nft.owner,
            },
            fromBlock: (blockNumber - 100000),
          };
          marketContract
              .getPastEvents("OrderCreated", options)
              .then((events: any[]) => {
                if (events.length == 0) {
                  resolve(null);
                } else if (events.length == 1) {
                  resolve(toOrderType(events[0], web3));
                } else if (events.length > 1) {
                  const order = events
                      .reduce((prev, current) => {
                        return (prev.blockNumber > current.blockNumber) ? prev : current;
                      });

                  resolve(toOrderType(order, web3));
                }
              });
        })
        .catch((err:any) => {
          logError("GetOrderError", "error getting oorder from chain", {"nft": nft, "error": err});
        });
  });
}

/**
 * converts input from chain into Order Type
 * @param {any} rawData data to be converted
 * @param {any} web3 is the web3 for converting to Hex
 * @return {Order} order order
 */
function toOrderType(rawData: any, web3:any): Order {
  const order: Order = {
    address: rawData.address,
    blockNumber: rawData.blockNumber,
    transactionHash: rawData.transactionHash,
    id: rawData.returnValues.id,
    tokenId: web3.utils.toHex(rawData.returnValues.assetId),
    seller: rawData.returnValues.seller,
    contractAddress: rawData.returnValues.nftAddress,
    price: rawData.returnValues.priceInWei,
    expiresAt: rawData.returnValues.expiresAt,
  };
  return order;
}

/**
 *
 * @param {Order} order order
 * @return {Promise<any>} probably?
 */
function saveOrderToDb(order: Order): Promise<boolean> {
  const orderRef = db.collection("Orders");
  return new Promise<boolean>((resolve, reject) => {
    orderRef.where("id", "==", order.id).get()
        .then((snapshots: any) => {
          if (snapshots.empty) {
            db.collection("Orders").add(order);
            resolve(true);
          } else {
            snapshots.forEach((snapshot: any) => {
              snapshot.ref.update(order);
            });
            resolve(true);
          }
        })
        .catch((err: any) => {
          logError("UpdateDbError", "maybe signature error", err);
          reject(err);
        });
  });
}

/**
 * asdafasdf
 * @param { Order } order the order beng processed
 * @return {any}
 */
function updateNFT(order: Order) :Promise<boolean> {
  logInfo("InfoGoingToDb", order);
  const nftRef = db.collection("NFTs");
  return new Promise((resolve, reject) => {
    nftRef.where("tokenId", "==", order.tokenId).get()
        .then((snapshots: any) => {
          if (snapshots.empty) {
            logInfo("NFTNotFoundInDB", {"tokenId": order.tokenId});
            resolve(false);
          } else {
            snapshots.forEach((snapshot: any) => {
              snapshot.ref.update({onSale: true, order: order});
            });
            resolve(true);
          }
        })
        .catch((err: any) => {
          logError("UpdateDbError", "maybe signature error", err);
          reject(err);
        });
  });
}
