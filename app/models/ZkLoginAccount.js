module.exports = mongoose => {
    const ZkLoginAccount = mongoose.model(
      "ZkLoginAccount",
      new mongoose.Schema(
        {
          email: { 
            type: String, 
            required: true, 
            unique: true, 
            index: true,
            lowercase: true,
            trim: true
          },
          suiAddress: { 
            type: String, 
            required: true, 
            index: true,  // Remove unique: true constraint
            default: "0x00"  // Provide a default value instead of null
          },
          userSalt: { 
            type: String, 
            required: true 
          },
          addressSeed: { 
            type: String, 
            required: true 
          },
          createdAt: { 
            type: Date, 
            default: Date.now 
          },
          updatedAt: {
            type: Date,
            default: Date.now
          }
        }
      )
    );
    
    return ZkLoginAccount;
  };