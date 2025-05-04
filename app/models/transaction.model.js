// app/models/transaction.model.js
module.exports = mongoose => {
    const transactionSchema = mongoose.Schema(
      {
        // Transaction metadata
        txDigest: {
          type: String,
          required: true,
          unique: true,
          index: true
        },
        txType: {
          type: String,
          enum: [
            'initializeChallenge',
            'joinChallenge',
            'completeExercise',
            'distributeRewards',
            'createNFT',
            'upgradeGem',
            'other'
          ],
          required: true
        },
        
        // User information
        address: {
          type: String,
          required: true,
          index: true
        },
        email: {
          type: String,
          sparse: true,
          index: true
        },
        
        // Challenge information
        poolId: {
          type: String,
          sparse: true,
          index: true
        },
        nftId: {
          type: String,
          sparse: true
        },
        
        // Transaction status
        status: {
          type: String,
          enum: ['success', 'failure', 'pending', 'unknown'],
          default: 'pending'
        },
        
        // Transaction details
        gasFee: {
          computationCost: String,
          storageCost: String,
          storageRebate: String,
          totalGas: String,
        },
        
        // Error tracking
        error: {
          message: String,
          code: String,
          details: mongoose.Schema.Types.Mixed
        },
        
        // Timestamping
        createdAt: {
          type: Date,
          default: Date.now
        },
        updatedAt: {
          type: Date,
          default: Date.now
        },
        finalizedAt: Date
      }
    );
  
    // Create model
    const Transaction = mongoose.model('Transaction', transactionSchema);
    
    return Transaction;
  };