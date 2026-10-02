/* ============================================================
   英语真题阅读资料库 · 篇目清单
   ------------------------------------------------------------
   ★ 作者更新新篇目时，照抄下面 2014 那段，改几个地方就行：
   1. 把文件放进对应年份文件夹 library/年份/（建议命名：年份-text序号-模式.html）
   2. 复制一段 { ... }，改 id、label、三个链接和 underlay 底稿图路径
   3. 保存刷新主页就能看到（记得浏览器 Ctrl+F5 强制刷新）
   底稿图不是必须的，没有就把 underlay 和 labels 两行删掉，
   笔记页会自动变成空白 A4 纸。
   ============================================================ */

const LIBRARY = {
  // 所有年份（2010-2026），没有篇目的年份主页会显示"待更新"
  2010: [
    {
      id: "2010-text1",
      label: "Text 1",
      zuoti: "library/2010/2010-text1-做题.html",
      fupan: "library/2010/2010-text1-复盘.html",
      note:  "notes.html?id=2010-text1",
      underlay: [
        "library/2010/2010-text1-article.png",
        "library/2010/2010-text1-question.png"
      ],
      labels: ["文章页", "题目页"]
    },
    {
      id: "2010-text2",
      label: "Text 2",
      zuoti: "library/2010/2010-text2-做题.html",
      fupan: "library/2010/2010-text2-复盘.html",
      note:  "notes.html?id=2010-text2",
      underlay: [
        "library/2010/2010-text2-article.png",
        "library/2010/2010-text2-question.png"
      ],
      labels: ["文章页", "题目页"]
    },
    {
      id: "2010-text4",
      label: "Text 4",
      zuoti: "library/2010/2010-text4-做题.html",
      fupan: "library/2010/2010-text4-复盘.html",
      note:  "notes.html?id=2010-text4",
      underlay: [
        "library/2010/2010-text4-article.png",
        "library/2010/2010-text4-question.png"
      ],
      labels: ["文章页", "题目页"]
    }
  ],
  2011: [
    {
      id: "2011-text1",
      label: "Text 1",
      zuoti: "library/2011/2011-text1-做题.html",
      fupan: "library/2011/2011-text1-复盘.html",
      note:  "notes.html?id=2011-text1",
      underlay: [
        "library/2011/2011-text1-article.png",
        "library/2011/2011-text1-question.png"
      ],
      labels: ["文章页", "题目页"]
    },
    {
      id: "2011-text2",
      label: "Text 2",
      zuoti: "library/2011/2011-text2-做题.html",
      note:  "notes.html?id=2011-text2",
      underlay: [
        "library/2011/2011-text2-article.png",
        "library/2011/2011-text2-question.png"
      ],
      labels: ["文章页", "题目页"]
    },
    {
      id: "2011-text3",
      label: "Text 3",
      zuoti: "library/2011/2011-text3-做题.html",
      fupan: "library/2011/2011-text3-复盘.html",
      note:  "notes.html?id=2011-text3",
      underlay: [
        "library/2011/2011-text3-article.png",
        "library/2011/2011-text3-question.png"
      ],
      labels: ["文章页", "题目页"]
    }
  ],
  2012: [
    {
      id: "2012-text3",
      label: "Text 3",
      zuoti: "library/2012/2012-text3-做题.html",
      fupan: "library/2012/2012-text3-复盘.html",
      note:  "notes.html?id=2012-text3",
      underlay: [
        "library/2012/2012-text3-article.png",
        "library/2012/2012-text3-question.png"
      ],
      labels: ["文章页", "题目页"]
    }
  ],
  2013: [
    {
      id: "2013-text1",
      label: "Text 1",
      zuoti: "library/2013/2013-text1-做题.html",
      note:  "notes.html?id=2013-text1",
      underlay: [
        "library/2013/2013-text1-article.png",
        "library/2013/2013-text1-question.png"
      ],
      labels: ["文章页", "题目页"]
    },
    {
      id: "2013-text2",
      label: "Text 2",
      zuoti: "library/2013/2013-text2-做题.html",
      fupan: "library/2013/2013-text2-复盘.html",
      note:  "notes.html?id=2013-text2",
      underlay: [
        "library/2013/2013-text2-article.png",
        "library/2013/2013-text2-question.png"
      ],
      labels: ["文章页", "题目页"]
    },
    {
      id: "2013-text3",
      label: "Text 3",
      zuoti: "library/2013/2013-text3-做题.html",
      fupan: "library/2013/2013-text3-复盘.html",
      note:  "notes.html?id=2013-text3",
      underlay: [
        "library/2013/2013-text3-article.png",
        "library/2013/2013-text3-question.png"
      ],
      labels: ["文章页", "题目页"]
    }
  ],
  2014: [
    {
      id: "2014-text1",
      label: "Text 1",
      zuoti: "library/2014/2014-text1-做题.html",
      fupan: "library/2014/2014-text1-复盘.html",
      note:  "notes.html?id=2014-text1",
      underlay: [
        "library/2014/2014-text1-article.png",
        "library/2014/2014-text1-question.png"
      ],
      labels: ["文章页", "题目页"]
    },
    {
      id: "2014-text2",
      label: "Text 2",
      zuoti: "library/2014/2014-text2-做题.html",
      note:  "notes.html?id=2014-text2",
      underlay: [
        "library/2014/2014-text2-article.png",
        "library/2014/2014-text2-question.png"
      ],
      labels: ["文章页", "题目页"]
    },
    {
      id: "2014-text3",
      label: "Text 3",
      zuoti: "library/2014/2014-text3-做题.html",
      fupan: "library/2014/2014-text3-复盘.html",
      note:  "notes.html?id=2014-text3",
      underlay: [
        "library/2014/2014-text3-article.png",
        "library/2014/2014-text3-question.png"
      ],
      labels: ["文章页", "题目页"]
    },
    {
      id: "2014-text4",
      label: "Text 4",
      zuoti: "library/2014/2014-text4-做题.html",
      fupan: "library/2014/2014-text4-复盘.html",
      note:  "notes.html?id=2014-text4",
      underlay: [
        "library/2014/2014-text4-article.png",
        "library/2014/2014-text4-question.png"
      ],
      labels: ["文章页", "题目页"]
    }
  ],
  2015: [
    {
      id: "2015-text1",
      label: "Text 1",
      zuoti: "library/2015/2015-text1-做题.html",
      fupan: "library/2015/2015-text1-复盘.html",
      note:  "notes.html?id=2015-text1",
      underlay: [
        "library/2015/2015-text1-article.png",
        "library/2015/2015-text1-question.png"
      ],
      labels: ["文章页", "题目页"]
    },
    {
      id: "2015-text3",
      label: "Text 3",
      zuoti: "library/2015/2015-text3-做题.html",
      fupan: "library/2015/2015-text3-复盘.html",
      note:  "notes.html?id=2015-text3",
      underlay: [
        "library/2015/2015-text3-article.png",
        "library/2015/2015-text3-question.png"
      ],
      labels: ["文章页", "题目页"]
    }
  ],
  2016: [],
  2017: [
    {
      id: "2017-text4",
      label: "Text 4",
      fupan: "library/2017/2017-text4-复盘.html",
      note:  "notes.html?id=2017-text4",
      underlay: [
        "library/2017/2017-text4-article.png",
        "library/2017/2017-text4-question.png"
      ],
      labels: ["文章页", "题目页"]
    }
  ],
  2018: [
    {
      id: "2018-text2",
      label: "Text 2",
      zuoti: "library/2018/2018-text2-做题.html",
      note:  "notes.html?id=2018-text2",
      underlay: [
        "library/2018/2018-text2-article.png",
        "library/2018/2018-text2-question.png"
      ],
      labels: ["文章页", "题目页"]
    },
    {
      id: "2018-text3",
      label: "Text 3",
      fupan: "library/2018/2018-text3-复盘.html",
      note:  "notes.html?id=2018-text3",
      underlay: [
        "library/2018/2018-text3-article.png",
        "library/2018/2018-text3-question.png"
      ],
      labels: ["文章页", "题目页"]
    },
    {
      id: "2018-text4",
      label: "Text 4",
      fupan: "library/2018/2018-text4-复盘.html",
      note:  "notes.html?id=2018-text4",
      underlay: [
        "library/2018/2018-text4-article.png",
        "library/2018/2018-text4-question.png"
      ],
      labels: ["文章页", "题目页"]
    }
  ],
  2019: [
    {
      id: "2019-text3",
      label: "Text 3",
      zuoti: "library/2019/2019-text3-做题.html",
      fupan: "library/2019/2019-text3-复盘.html",
      note:  "notes.html?id=2019-text3",
      underlay: [
        "library/2019/2019-text3-article.png",
        "library/2019/2019-text3-question.png"
      ],
      labels: ["文章页", "题目页"]
    }
  ],
  2020: [],
  2021: [
    {
      id: "2021-text1",
      label: "Text 1",
      fupan: "library/2021/2021-text1-复盘.html",
      note:  "notes.html?id=2021-text1",
      underlay: [
        "library/2021/2021-text1-article.png",
        "library/2021/2021-text1-question.png"
      ],
      labels: ["文章页", "题目页"]
    },
    {
      id: "2021-text3",
      label: "Text 3",
      fupan: "library/2021/2021-text3-复盘.html",
      note:  "notes.html?id=2021-text3",
      underlay: [
        "library/2021/2021-text3-article.png",
        "library/2021/2021-text3-question.png"
      ],
      labels: ["文章页", "题目页"]
    }
  ],
  2022: [],
  2023: [],
  2024: [
    {
      id: "2024-text3",
      label: "Text 3",
      fupan: "library/2024/2024-text3-复盘.html",
      note:  "notes.html?id=2024-text3",
      underlay: [
        "library/2024/2024-text3-article.png",
        "library/2024/2024-text3-question.png"
      ],
      labels: ["文章页", "题目页"]
    }
  ],
  2025: [
    {
      id: "2025-text2",
      label: "Text 2",
      zuoti: "library/2025/2025-text2-做题.html",
      fupan: "library/2025/2025-text2-复盘.html",
      note:  "notes.html?id=2025-text2",
      underlay: [
        "library/2025/2025-text2-article.png",
        "library/2025/2025-text2-question.png"
      ],
      labels: ["文章页", "题目页"]
    },
    {
      id: "2025-text4",
      label: "Text 4",
      zuoti: "library/2025/2025-text4-做题.html",
      fupan: "library/2025/2025-text4-复盘.html",
      note:  "notes.html?id=2025-text4",
      underlay: [
        "library/2025/2025-text4-article.png",
        "library/2025/2025-text4-question.png"
      ],
      labels: ["文章页", "题目页"]
    }
  ],
  2026: []
};
