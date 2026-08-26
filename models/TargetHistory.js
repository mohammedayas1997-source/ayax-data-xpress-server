const mongoose = require("mongoose");

const TargetHistorySchema = new mongoose.Schema(
  {
    // 1. Relational Assignment Mapping
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // 2. Geographic Territory Mapping
    state: {
      type: String,
      trim: true,
      index: true,
      default: "Kano",
    },

    lga: {
      type: String,
      trim: true,
      index: true,
      default: "",
    },

    // 3. Performance Targets & KPI Metrics
    dataGoal: {
      type: Number,
      min: 0,
      default: 0, // Volume target in Gigabytes (GB)
    },

    airtimeGoal: {
      type: Number,
      min: 0,
      default: 0, // Airtime VTU sales target in Naira (₦)
    },

    agentGoal: {
      type: Number,
      min: 0,
      default: 0, // Onboarded agents recruitment goal
    },

    supervisorGoal: {
      type: Number,
      min: 0,
      default: 0, // LGA supervisors recruitment goal (State Manager level)
    },

    salesGoal: {
      type: Number,
      min: 0,
      default: 0, // Total monetary gross revenue target (₦)
    },

    // 4. Real-Time Achieved Records
    achievedData: {
      type: Number,
      default: 0,
      min: 0,
    },

    achievedAirtime: {
      type: Number,
      default: 0,
      min: 0,
    },

    achievedAgents: {
      type: Number,
      default: 0,
      min: 0,
    },

    achievedSupervisors: {
      type: Number,
      default: 0,
      min: 0,
    },

    achievedSales: {
      type: Number,
      default: 0,
      min: 0,
    },

    // 5. Period & Temporal Tracking
    month: {
      type: String,
      required: true,
      trim: true,
      index: true, // e.g. "August 2026"
    },

    periodCode: {
      type: String,
      trim: true,
      index: true, // e.g. "2026-08"
    },

    startDate: {
      type: Date,
    },

    endDate: {
      type: Date,
    },

    // 6. Target Lifecycle & Evaluation Status
    status: {
      type: String,
      enum: ["Active", "Completed", "Failed", "Pending", "Reviewed", "Cleared"],
      default: "Active",
      index: true,
    },

    bonusAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    isBonusPaid: {
      type: Boolean,
      default: false,
      index: true,
    },

    notes: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual Calculation: Data Completion Percentage
TargetHistorySchema.virtual("dataProgress").get(function () {
  if (!this.dataGoal || this.dataGoal <= 0) return 0;
  const percent = (this.achievedData / this.dataGoal) * 100;
  return Number(Math.min(percent, 100).toFixed(2));
});

// Virtual Calculation: Airtime Completion Percentage
TargetHistorySchema.virtual("airtimeProgress").get(function () {
  if (!this.airtimeGoal || this.airtimeGoal <= 0) return 0;
  const percent = (this.achievedAirtime / this.airtimeGoal) * 100;
  return Number(Math.min(percent, 100).toFixed(2));
});

// Virtual Calculation: Agent Recruitment Completion Percentage
TargetHistorySchema.virtual("agentProgress").get(function () {
  if (!this.agentGoal || this.agentGoal <= 0) return 0;
  const percent = (this.achievedAgents / this.agentGoal) * 100;
  return Number(Math.min(percent, 100).toFixed(2));
});

// Virtual Calculation: Overall Composite Target Progress
TargetHistorySchema.virtual("overallProgress").get(function () {
  let activeGoals = 0;
  let totalScore = 0;

  if (this.dataGoal > 0) {
    activeGoals += 1;
    totalScore += Math.min((this.achievedData / this.dataGoal) * 100, 100);
  }

  if (this.airtimeGoal > 0) {
    activeGoals += 1;
    totalScore += Math.min((this.achievedAirtime / this.airtimeGoal) * 100, 100);
  }

  if (this.agentGoal > 0) {
    activeGoals += 1;
    totalScore += Math.min((this.achievedAgents / this.agentGoal) * 100, 100);
  }

  if (this.supervisorGoal > 0) {
    activeGoals += 1;
    totalScore += Math.min((this.achievedSupervisors / this.supervisorGoal) * 100, 100);
  }

  return activeGoals > 0 ? Number((totalScore / activeGoals).toFixed(2)) : 0;
});

// Pre-save Middleware: Format Period Code and Evaluate Lifecycle
TargetHistorySchema.pre("save", function (next) {
  if (!this.periodCode && this.month) {
    const d = new Date(this.month);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const monthNum = String(d.getMonth() + 1).padStart(2, "0");
      this.periodCode = `${year}-${monthNum}`;
    }
  }

  if (this.dataGoal === 0 && this.airtimeGoal === 0 && this.agentGoal === 0) {
    this.status = "Cleared";
  } else if (
    this.status === "Active" &&
    (this.dataGoal === 0 || this.achievedData >= this.dataGoal) &&
    (this.airtimeGoal === 0 || this.achievedAirtime >= this.airtimeGoal) &&
    (this.agentGoal === 0 || this.achievedAgents >= this.agentGoal)
  ) {
    this.status = "Completed";
  }

  next();
});

// Optimized Compound Indexes
TargetHistorySchema.index({ assignedTo: 1, month: -1 });
TargetHistorySchema.index({ assignedTo: 1, periodCode: -1 });
TargetHistorySchema.index({ state: 1, month: -1 });
TargetHistorySchema.index({ status: 1, month: -1 });
TargetHistorySchema.index({ assignedBy: 1, createdAt: -1 });

module.exports =
  mongoose.models.TargetHistory ||
  mongoose.model("TargetHistory", TargetHistorySchema);