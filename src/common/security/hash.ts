import * as bcrypt from 'bcryptjs';

export const hashValue = async (value: string) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(value, salt);
};

export const verifyHash = async (value: string, hash: string) => {
  return await bcrypt.compare(value, hash);
};
