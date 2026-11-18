/**
 * Ending — the extra-credit axis.
 *
 * An ending is not part of the 100-point read; it is a separate `-1 … +20`
 * band on top. The author's reason: "the total is the overall reading
 * experience; the extra credit is how good the standout part is." Adding them
 * together would flatten that distinction.
 *
 * Two components:
 *   走向   reversal beats open beats following through, in that order
 *   形式   a closing that returns to the opening, if the two really connect
 *
 * Ported from `p11_ending.py`.
 */

const BASE = {
  反转: 1.0,
  留白: 0.7,
  顺势: 0.0, // following through is not "excellent", so it earns nothing
}

export const W_TREND = 6
export const W_FORM = 4
const LINK_FULL = 0.85
const SETUP_MIN = 0.6
const PEN_SETUP = 0.4

const FORMS = ['直接终结', '首尾相连']
const TRENDS = ['顺势', '反转', '留白']

/**
 * Blank-space grading. Whether a blank ending works depends on whether the
 * reader has enough material to fill it — which is a question about position
 * and prior setup, both of which are annotated.
 */
function gradeBlank(endingPara, p1Rows) {
  if (!p1Rows || !p1Rows.length) return null
  const n = p1Rows.length
  const blanks = p1Rows.filter((r) => r.function === '留白').map((r) => Number(r.para))
  if (!blanks.length) return null
  const last = Math.max(...blanks)
  const atEnd = last >= n - 2
  const PREP = ['交代', '铺垫', '蓄势', '安抚', '回收']
  let hasPrep = false
  for (let i = Math.max(0, last - 3); i < last - 1; i += 1) {
    if (PREP.includes(p1Rows[i]?.function)) hasPrep = true
  }
  if (atEnd) {
    return { q: 1.0, why: `留白落在结尾（段 ${last}/${n}），前面整篇都是材料` }
  }
  if (hasPrep) {
    return { q: 0.7, why: `留白在中段（段 ${last}/${n}），前面有铺垫可推` }
  }
  return {
    q: 0.4,
    why: `留白在中段（段 ${last}/${n}），前面没有铺垫——读者不知道在留什么，那不是留白，是没写完`,
  }
}

/**
 * @param {object} annotation one parsed ending annotation
 * @param {object[]} p1Rows   the paragraph annotation, for blank grading
 */
export function score(annotation, p1Rows) {
  const form = annotation?.form
  const trend = annotation?.trend
  if (!FORMS.includes(form)) {
    return { unmeasured: `结尾的 form 字段不合法（${JSON.stringify(form)}）` }
  }
  if (!TRENDS.includes(trend)) {
    return { unmeasured: `结尾的 trend 字段不合法（${JSON.stringify(trend)}）` }
  }

  const hints = []

  // 走向
  let trendPt = BASE[trend] * W_TREND
  if (trend === '反转') {
    const sq = annotation.setup_quality
    if (sq == null) return { unmeasured: '反转但没标 setup_quality，判不了' }
    if (Number(sq) < SETUP_MIN) {
      trendPt -= PEN_SETUP * W_TREND
      hints.push(`反转没铺垫（${Number(sq).toFixed(2)}），扣 ${(PEN_SETUP * W_TREND).toFixed(1)}`)
    }
  }

  // 留白分档
  let blank = null
  if (trend === '留白') {
    blank = gradeBlank(annotation.last_para, p1Rows)
    if (blank) {
      trendPt *= blank.q
      if (blank.q < 0.7) {
        hints.push(
          '留白留在中段，前面没有铺垫——读者接不住。要么往前补一段材料，要么把留白挪到结尾',
        )
      }
    }
  }

  // 形式
  let formPt = 0
  if (form === '首尾相连') {
    const lq = annotation.link_quality
    if (lq == null) return { unmeasured: '首尾相连但没标 link_quality，判不了' }
    if (Number(lq) >= LINK_FULL) formPt = W_FORM
    else hints.push(`首尾相连但相关度只有 ${Number(lq).toFixed(2)}，不够 ${LINK_FULL}，不给分`)
  }

  trendPt = Math.round(trendPt * 100) / 100
  const total = Math.round((trendPt + formPt) * 100) / 100

  if (trend === '顺势') {
    hints.push('结尾是顺势收的——最稳，但也几乎没有加分空间。想加分可以想想能不能改成反转或留白。')
  }
  if (blank) hints.push(`留白分档 ${blank.q}：${blank.why}`)

  return {
    total,
    trend: trendPt,
    form: formPt,
    trendLabel: trend,
    formLabel: form,
    blank,
    hints,
  }
}
