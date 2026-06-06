const mongoose = require('mongoose');

const list = async (req, res) => {
  const FileModel = mongoose.model('File');
  const JobModel = mongoose.model('Job');

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.items, 10) || 10;
  const skip = (page - 1) * limit;
  const { sortBy, sortValue = -1, q } = req.query;
  const sortSpec = sortBy
    ? { [sortBy]: Number(sortValue) }
    : { created: -1, _id: -1 };

  const filter = { removed: false, createdBy: req.admin._id };
  if (q && q.trim()) {
    filter.originalName = { $regex: new RegExp(q.trim(), 'i') };
  }

  const [files, count] = await Promise.all([
    FileModel.find(filter).skip(skip).limit(limit).sort(sortSpec).lean().exec(),
    FileModel.countDocuments(filter),
  ]);

  const jobIds = files.map((f) => f.transcriptionJobId).filter(Boolean);
  const jobs = jobIds.length
    ? await JobModel.find({ _id: { $in: jobIds } }).select('status').lean()
    : [];
  const jobStatusById = new Map(jobs.map((j) => [String(j._id), j.status]));

  const result = files.map((f) => ({
    ...f,
    transcriptionStatus: f.transcriptionJobId
      ? jobStatusById.get(String(f.transcriptionJobId)) || null
      : null,
  }));

  const pages = Math.ceil(count / limit);
  const pagination = { page, pages, count };

  if (count > 0) {
    return res.status(200).json({
      success: true,
      result,
      pagination,
      message: 'Successfully found all documents',
    });
  }
  return res.status(203).json({
    success: true,
    result: [],
    pagination,
    message: 'Collection is Empty',
  });
};

module.exports = list;
