const RemoteProofs = require('./remote-proofs')
const {t2a, a2t } = require('./crypto')
const { log, error } = require('./log')
const { OBJECT, STRING, UNDEFINED,
        ARRAY, INTEGER, BOOL, FUNCTION } = require('./utils')

class Proof {

  constructor (proofsDB, identity, ipfs, crypto) {
    if (!proofsDB || !identity || !ipfs || !crypto) {
      throw new Error('proofsDB, identity, ipfs, crypto are required')
    }

    this.proofsDB = proofsDB
    this.identity = identity
    this.ipfs = ipfs
    this.crypto = crypto
    // isn't that cute? they need each other
    this.remoteProofs = new RemoteProofs(this)

    this.updateLocalValidityDocs()
  }

  updateLocalValidityDocs () {
    // `validityDocs` are proofs that the peer profile carries
    // around and broadcasts to peers as p2p discovery happens
    // get all local client proofs and add them to the identity prop
    // fire and forget as needed
    const that = this

    this.proofsDB.getValidityDocs().then((res) => {
      if (res) {
        that.identity.validityDocs = res
      }
    }).catch((ex) => {
      console.error(ex)
    })
  }

  async saveProof (content) {
    const that = this
    var proofData = content
    if (typeof content === OBJECT) {
      proofData = JSON.stringify(content)
    }
    return this.ipfs.saveProofToIpfs(proofData).then((res) => {
      let hash = res[0].hash
      proofData = JSON.parse(proofData)
      proofData.ipfsContentHash = hash

      that.proofsDB.create(proofData).then((res) => {
        that.updateLocalValidityDocs()
        return true
      }).catch((ex) => {
        error(ex)
        return ex
      })
    }).catch((ex) => {
      error(ex)
      return ex
    })
  }

  // TODO: expires default should be `0` to denote N/A???
  createProof (username, service, callback, expires=null) {
    // Sign message, returning an Object with
    // service, username, message, handle and signature
    const that = this
    if (!username || !service) {
      throw new Error(ERR.ARG_REQ_USERNAME_SERVICE)
    }
    const ts = Date.now()

    let message = {
      statement: `I am ${username} on ${service}`, // add URL here
      username: username,
      service: service
    }

    let proof = JSON.stringify({
      message: message,
      timestamp: ts,
      expires: expires,
      ipfsId: this.identity.peerId,
      handle: this.identity.handle
    })

    this.crypto.sign(proof, (err, signature) => {
      if (err) { throw new Error(err) }

      let assertion = {
        handle: that.identity.handle,
        ipfsId: that.identity.peerId,
        proof: proof,
        signature: that.crypto.dehydrate(signature),
        timestamp: ts,
        publicKey: that.crypto.pubKeyDehydrated
      }
      if (callback) {
        callback(err, assertion)
      }
    })
  }

  verifyProof (proof, callback) {
    // make sure the proof signature was generated by the
    // private half of publicKey
    let _proof
    if (typeof proof == STRING) {
      _proof = JSON.parse(proof)
    } else {
      _proof = proof
    }
    if (proof.doc) {
      _proof = proof.doc
    }
    const signedProofText = JSON.stringify(_proof.proof) // JSON -> string
    const obj = JSON.parse(_proof.signature)
    // Get the Uint8Array version of the stringified data (key or signature)
    const bufferSig = Buffer.from(obj)
    const objKey = JSON.parse(_proof.publicKey)
    // Get the Uint8Array version of the stringified key
    const bufferKey = Buffer.from(objKey)
    // unmarshal pub key (any pub key)
    const publicKey = this.crypto._crypto.keys.unmarshalPublicKey(bufferKey)
    const textArr = t2a(signedProofText) // encode text to array
    // check the signature in the proof
    return publicKey.verify(textArr, bufferSig, callback)
  }
}

module.exports = Proof
