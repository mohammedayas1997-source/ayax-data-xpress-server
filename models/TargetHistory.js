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
    },

    // Burin da aka sa (Goals)
    dataGoal: { type: Number, required: true }, // Misali: 500GB
    agentGoal: { type: Number, required: true }, // Misali: Sabbin Agents 10

    // Abin da aka samu (Actual Achievements)
    achievedData: { type: Number, default: 0 },
    achievedAgents: { type: Number, default: 0 },

    // Watan da target din yake nufi
    month: {
      type: String,
      required: true,
      index: true, // Misali: "May 2026"
    },

    status: {
      type: String,
      enum: ["Active", "Completed", "Failed"],
      default: "Active",
    },
  },
  {
    timestamps: true,
    // Wannan zai bamu damar lissafa percentage kai tsaye
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// VIRTUALS: Lissafin kashi nawa aka cimma (Performance Percentage)
TargetHistorySchema.virtual("dataProgress").get(function () {
  return this.dataGoal > 0 ? (this.achievedData / this.dataGoal) * 100 : 0;
});

TargetHistorySchema.virtual("agentProgress").get(function () {
  return this.agentGoal > 0 ? (this.achievedAgents / this.agentGoal) * 100 : 0;
});

// Indexing domin Dashboard ya rinka fito da tarihin watanni da sauri
TargetHistorySchema.index({ assignedTo: 1, month: -1 });

module.exports = mongoose.model("TargetHistory", TargetHistorySchema);
