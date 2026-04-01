var express = require("express");
var router = express.Router();
var multer = require("multer");
var path = require("path");
let messageModel = require("../schemas/messages");
let mongoose = require("mongoose");
let { CheckLogin } = require("../utils/authHandler");

// Multer config: lưu file vào thư mục uploads/
var storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    var ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  },
});
var upload = multer({ storage: storage });

// GET / - lấy tin nhắn cuối cùng của mỗi cuộc hội thoại
router.get("/", CheckLogin, async function (req, res, next) {
  try {
    let currentUserId = req.user._id;

    let lastMessages = await messageModel.aggregate([
      {
        $match: {
          $or: [
            { from: new mongoose.Types.ObjectId(currentUserId) },
            { to: new mongoose.Types.ObjectId(currentUserId) },
          ],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $addFields: {
          partner: {
            $cond: {
              if: { $eq: ["$from", new mongoose.Types.ObjectId(currentUserId)] },
              then: "$to",
              else: "$from",
            },
          },
        },
      },
      {
        $group: {
          _id: "$partner",
          lastMessage: { $first: "$$ROOT" },
        },
      },
      {
        $replaceRoot: { newRoot: "$lastMessage" },
      },
      {
        $lookup: {
          from: "users",
          localField: "from",
          foreignField: "_id",
          as: "from",
        },
      },
      { $unwind: "$from" },
      {
        $lookup: {
          from: "users",
          localField: "to",
          foreignField: "_id",
          as: "to",
        },
      },
      { $unwind: "$to" },
      {
        $project: {
          "from.password": 0,
          "to.password": 0,
        },
      },
    ]);

    res.send(lastMessages);
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});

// GET /:userID - lấy toàn bộ tin nhắn giữa user hiện tại và userID
router.get("/:userID", CheckLogin, async function (req, res, next) {
  try {
    let currentUserId = req.user._id;
    let otherUserId = req.params.userID;

    let messages = await messageModel
      .find({
        $or: [
          {
            from: currentUserId,
            to: otherUserId,
          },
          {
            from: otherUserId,
            to: currentUserId,
          },
        ],
      })
      .populate("from", "-password")
      .populate("to", "-password")
      .sort({ createdAt: 1 });

    res.send(messages);
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});

// POST / - gửi tin nhắn (text hoặc file)
router.post("/", CheckLogin, upload.single("file"), async function (req, res, next) {
  try {
    let currentUserId = req.user._id;
    let toUserId = req.body.to;

    if (!toUserId) {
      return res.status(400).send({ message: "Thiếu thông tin người nhận (to)" });
    }

    let type, text;

    if (req.file) {
      // Có file đính kèm
      type = "file";
      text = req.file.path.replace(/\\/g, "/");
    } else {
      // Tin nhắn text
      if (!req.body.text) {
        return res.status(400).send({ message: "Thiếu nội dung tin nhắn (text)" });
      }
      type = "text";
      text = req.body.text;
    }

    let newMessage = new messageModel({
      from: currentUserId,
      to: toUserId,
      messageContent: {
        type: type,
        text: text,
      },
    });

    await newMessage.save();

    let saved = await messageModel
      .findById(newMessage._id)
      .populate("from", "-password")
      .populate("to", "-password");

    res.send(saved);
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});

module.exports = router;
