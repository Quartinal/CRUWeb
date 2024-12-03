export async function calculateChecksum(
  data: ArrayBuffer,
  algorithm: 'md5' | 'sha1',
): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    algorithm === 'md5' ? 'MD5' : 'SHA-1',
    data,
  )
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function verifyImage(
  data: ArrayBuffer,
  md5: string,
  sha1: string,
): Promise<boolean> {
  const [calculatedMd5, calculatedSha1] = await Promise.all([
    calculateChecksum(data, 'md5'),
    calculateChecksum(data, 'sha1'),
  ])

  return calculatedMd5 === md5 && calculatedSha1 === sha1
}
