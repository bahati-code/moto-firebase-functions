import {v4 as uuidv4} from "uuid";
const admin = require("firebase-admin");
const bucketUrl = "gs://motonetworknft";
const serviceAccount = require("../motonetwork-dd52ce6878e4.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: bucketUrl,
});
const bucket = admin.storage().bucket(bucketUrl);
const db = admin.firestore();
const Busboy = require("busboy");
const path = require("path");
const os = require("os");
const fs = require("fs");
const jimp = require("jimp");
import {logError, logInfo} from "./index";

interface Metadata {
  filename: string;
  mimetype: string;
  encoding: string;
  nftfilename?: string;
  phash?: string;
}
interface NFT {
  name: string;
  owner: string;
  chainId: number;
  tokenId: string;
  contractAddress: string;
  contentHash: string;
  creator: string;

}
/**
 * adds nft information to firebase database to be accessible to other components
 * @param {object} req
 * @param {object} res
 * @return {void} void
 */
export function uploadNFT(req: any, res: any): void {
  const busboy = new Busboy({headers: req.headers});
  let nftFilename: string | null = null;
  const fileInfo: Metadata = {
    nftfilename: "",
    mimetype: "",
    encoding: "",
    filename: "",
  };
  let filepath: string = "";
  const tmpdir = os.tmpdir();
  req.pipe(busboy);
  busboy.on("field", (fieldname: any, value: any) => {
    if (fieldname == "nft") {
      const nft: NFT = JSON.parse(value);
      nftFilename = nft.contentHash;
      fileInfo.nftfilename = nftFilename;
      db.collection("NFTs").add(nft)
          .then(() => { })
          .catch((err: any) => {
            logError("Save to DB", "Firestore interaction error", err);
            res.status(500).send();
          });
    }
  });

  busboy.on("file",
      (fieldname: string, file: any, filename: string,
          encoding: string, mimetype: string) => {
        filepath = path.join(tmpdir, filename);
        fileInfo.mimetype = mimetype;
        fileInfo.encoding = encoding;
        fileInfo.filename = filename;
        const writeStream = fs.createWriteStream(filepath);
        file.pipe(writeStream);

        file.on("end", () => {
          writeStream.end();
          processFile(fileInfo, filepath)
              .then((result: boolean) => {
                if (result) {
                  res.status(200).send();
                } else {
                  res.status(500).send();
                }
              });
        });
      });

  busboy.on("finish", ()=>{ });

  busboy.end(req.rawBody);
}
/**
 *
 * @param {Metadata}fileInfo
 * @param {string} filepath
 * @return {Promise<boolean>} promise finished
 */
function processFile(fileInfo: Metadata, filepath: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    if (fileInfo.mimetype.startsWith("image")) {
      Promise.all([genPreviewAndPhash(fileInfo, filepath),
        sendToStorage(fileInfo, filepath)])
          .then((results) => {
            if (results[0] && results[1]) {
              resolve(updateDb(fileInfo));
            } else {
              resolve(false);
            }
          })
          .catch((err) => {
            logError("PreviewGenError", "error with preview ", err);
            reject(err);
          });
    } else {
      sendToStorage(fileInfo, filepath)
          .then((result) => {
            if (result) {
              resolve(updateDb(fileInfo));
            }
          })
          .catch((err) => {
            logError("SendToStorageError", "you know", err);
            Promise.reject(err);
          });
    }
  });
}

/**
 * send to storage
 * @param {object} metadata has file info
 * @param {string} filepath the data
 * @return {Promise}
 */
function sendToStorage(metadata: Metadata, filepath: string): Promise<any> {
  const location = metadata.mimetype.slice(0, metadata.mimetype.indexOf("/") + 1);
  return bucket
      .upload(filepath, {
        "destination": location + metadata.nftfilename,
        "contentType": metadata.mimetype,
        "contentEncoding": metadata.encoding,
        "gzip": true,
        "contentDisposition": "Attachement;filename=" + metadata.filename,
        "metadata":
      {
        "contentEncoding": metadata.encoding,
        "contentType": metadata.mimetype,
        "metadata": {
          firebaseStorageDownloadTokens: uuidv4(),
        },
      },
        "private": false,
      });
}

/**
 * generate preview images and the phash
 * @param {Metadata} metadata
 * @param {string} filepath
 * @return {promise }
 */
function genPreviewAndPhash(metadata: any, filepath: string): Promise<any> {
  logInfo("CreatingImagePreviews", {"metadata": metadata, "filepath": filepath});
  const tmpdir = os.tmpdir();
  const logoFile: string = "./lib/logo.png";
  const smMeta: Metadata = {
    filename: "sm_" + metadata.filename,
    nftfilename: "sm_" + metadata.nftfilename,
    encoding: metadata.encoding,
    mimetype: metadata.mimetype,
  };
  const medMeta: Metadata = {
    filename: "med_" + metadata.filename,
    nftfilename: "med_" + metadata.nftfilename,
    encoding: metadata.encoding,
    mimetype: metadata.mimetype,
  };
  const smPath: string = path.join(tmpdir, smMeta.nftfilename);
  const medPath: string = path.join(tmpdir, medMeta.nftfilename);
  return Promise.all([
    jimp.read(logoFile), jimp.read(filepath)])
      .then((files) => {
        const logo = files[0];
        const uploadedFile = files[1];
        const medImg = uploadedFile.clone();
        const smImg = uploadedFile.clone();
        const smLogo = logo.clone();
        const medLogo = logo.clone();
        logInfo("Image and Logo Read", metadata);
        metadata.phash = uploadedFile.hash(16);
        logInfo("PhashCreated", metadata.phash);

        medLogo
            .contain(medImg.bitmap.width, jimp.AUTO)
            .opacity(0.3);
        medImg
            .composite(medLogo, 0, Math.floor(medImg.bitmap.height / 3), [
              {
                mode: jimp.BLEND_ADD,
                opacitySource: 1,
                opacityDest: 0.5,
              },
            ])
            .resize(700, jimp.AUTO)
            .quality(50);

        smLogo
            .contain(smImg.bitmap.width, jimp.AUTO)
            .opacity(0.2);
        smImg
            .composite(smLogo, 0, Math.floor(smImg.bitmap.height / 3), [
              {
                mode: jimp.BLEND_ADD,
                opacitySource: 1,
                opacityDest: 0.5,
              },
            ])
            .resize(jimp.AUTO, 400)
            .quality(20);
        logInfo("PreviewsProcessed", "Images resized and watermarked");
        return Promise.all([
          saveFile(smImg, smMeta, smPath),
          saveFile(medImg, medMeta, medPath),
        ]);
      });

  /**
   *
   * @param {any} image
   * @param {metadata} metadata
   * @param {string} path
   * @return {promise}
   */
  function saveFile(image: any, metadata: Metadata, path: string): Promise<any> {
    return image.writeAsync(path)
        .then(() => {
          logInfo("StartingFileSaving",
              {"metadata": metadata, "path": path});
          return sendToStorage(metadata, path);
        });
  }
}


/**
 * udpate firestore DB
 * @param {Metadata} metadata
 * @return {promise}
 */
function updateDb(metadata: Metadata): Promise<boolean> {
  if (metadata.mimetype.startsWith("image")) {
    prepareSignedUrls(metadata)
        .then((signedUrlsObject) => {
          const newData = addJSONs([metadata, signedUrlsObject]);
          return _updateDB(newData);
        });
  }

  return _updateDB(metadata);
}

/**
 * save new data to previous db records
 * @param {Metadata} data
 * @return {Promise}
 */
function _updateDB(data: any): Promise<boolean> {
  logInfo("InfoGoingToDb", data);
  const nftRef = db.collection("NFTs");
  return new Promise<boolean>((resolve, reject) => {
    nftRef.where("contentHash", "==", data.nftfilename).get()
        .then((snapshots: any) => {
          if (snapshots.empty) {
            logInfo("NFTNotFoundInDB", {"contentHash": data.nftfilename});
            resolve(false);
          } else {
            logInfo("NFTFound", {"contentHash": data.nftfilename});
            snapshots.forEach((snapshot: any) => {
              snapshot.ref.update(data);
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
 *
 * @param {Metadata} metadata
 * @return {Promise}
 */
function prepareSignedUrls(metadata: Metadata): Promise<any> {
  const smImgFile = bucket.file("image/" + "sm_" + metadata.nftfilename);
  const medImgFile = bucket.file("image/" + "med_" + metadata.nftfilename);

  const signedUrlOptions = {
    action: "read",
    expires: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000,
  };
  return Promise.all(
      [smImgFile.getSignedUrl(signedUrlOptions),
        medImgFile.getSignedUrl(signedUrlOptions),
      ])
      .then((signedUrls) => {
        logInfo("SignedUrlsDone");
        const newInfo = {
          "smImg": signedUrls[0][0],
          "medImg": signedUrls[1][0], // google sends urls as arrays
        };
        return newInfo;
      });
}

/**
 * combines an array of objects into one
 * @param {any[]}jsonArray
 * @return {any}
 */
function addJSONs(jsonArray: any): any {
  const newObject: any = {};
  for (let index = 0; index < jsonArray.length; index++) {
    for (const key in jsonArray[index]) {
      if (Object.prototype.hasOwnProperty.call(jsonArray[index], key)) {
        newObject[key] = jsonArray[index][key];
      }
    }
  }
  return newObject;
}

