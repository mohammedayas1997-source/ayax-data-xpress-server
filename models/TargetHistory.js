const mongoose = require("mongoose");

const TargetHistorySchema = new mongoose.Schema(
  {
    // Wanda aka baiwa target din (Supervisor ko Agent)
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Shugaban da ya bayar da target din (Leader ko Admin)
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Burin da aka sa (Goals)
    dataGoal: { 
      type: Number, 
      required: true,
      min: 0,
      default: 0,
    }, // Misali: 500GB
    
    agentGoal: { 
      type: Number, 
      required: true,
      min: 0,
      default: 0,
    }, // Misali: Sabbin Agents 10

    // Abin da aka samu (Actual Achievements)
    achievedData: { 
      type: Number, 
      default: 0,
      min: 0,
    },
    
    achievedAgents: { 
      type: Number, 
      default: 0,
      min: 0,
    },

    // Watan da target din yake nufi (Misali: "May 2026" ko tsarin YYYY-MM don sauƙaƙe bincike)
    month: {
      type: String,
      required: true,
      trim: true,
      index: true, // Misali: "May 2026"
    },

    status: {
      type: String,
      enum: ["Active", "Completed", "Failed", "Pending"],
      default: "Active",
      index: true,
    },
  },
  {
    timestamps: true,
    // Wannan zai bamu damar lissafa percentage kai tsaye a cikin JSON
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// VIRTUALS: Lissafin kashi nawa aka cimma (Performance Percentage) da kuma jimlar nasara
TargetHistorySchema.virtual("dataProgress").get(function () {
  return this.dataGoal > 0 ? Number(((this.achievedData / this.dataGoal) * 100).toFixed(2)) : 0;
});

TargetHistorySchema.virtual("agentProgress").get(function () {
  return this.agentGoal > 0 ? Number(((this.achievedAgents / this.agentGoal) * 100).toFixed(2)) : 0;
});

// Ingantattun Indexes domin Dashboard ya rinka fito da tarihin watanni da lissafin aiki da sauri sosai
TargetHistorySchema.index({ assignedTo: 1, month: -1 });
TargetHistorySchema.index({ status: 1, month: -1 });

module.exports = mongoose.model("TargetHistory", TargetHistorySchema);