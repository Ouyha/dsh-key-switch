#!/bin/sh
# 从 GitHub 直接装 dsh-key-switch：取源码 → 跑到 install.mjs，装到哪由它自动判断。
#
#   电脑：curl -fsSL https://raw.githubusercontent.com/Ouyha/dsh-key-switch/main/install.sh | sh
#   手机：DSH Go › 设置 › 引擎 › 终端，同一条命令
#
# 带参数时要走 `sh -s --`：
#   curl -fsSL .../install.sh | sh -s -- --dsh-go
#   curl -fsSL .../install.sh | sh -s -- --print-target
#
# 环境变量：
#   DSH_KEY_SWITCH_REPO  仓库地址，默认官方 GitHub
#   DSH_KEY_SWITCH_REF   分支或标签，默认 main
#   DSH_KEY_SWITCH_SRC   直接用本地已 clone 的目录，不联网
#
# 源码留在固定位置（不是临时目录）：profile 里的 file: 依赖指向它，删了下次 pnpm 就找不到插件。
set -eu

REPO="${DSH_KEY_SWITCH_REPO:-https://github.com/Ouyha/dsh-key-switch.git}"
REF="${DSH_KEY_SWITCH_REF:-main}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"

say() { printf '%s\n' "$*"; }
die() { printf '出错：%s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die '找不到 node。DSH 自己就跑在 Node 上，先确认它在 PATH 里。'
node -e 'const [maj, min] = process.versions.node.split(".").map(Number); process.exit(maj >= 24 || (maj === 22 && min >= 19) ? 0 : 1)' 2>/dev/null \
  || die "Node 版本太旧（$(node -v 2>/dev/null || echo 未知)），需要 22.19 以上或 24+。"

# 装到哪：和 tools/target.mjs 同一套判断（手机版把源码放进「重置引擎也保留」的目录）。
LOCAL_SRC=0
if [ -n "${DSH_KEY_SWITCH_SRC:-}" ]; then
  SRC="$DSH_KEY_SWITCH_SRC"
  LOCAL_SRC=1
elif [ -d "$DSH_HOME_DIR/dsh-go" ] || [ -d /opt/dsh-go ]; then
  SRC="$DSH_HOME_DIR/dsh-go/plugins/dsh-key-switch"
else
  SRC="$DSH_HOME_DIR/dsh-key-switch"
fi

say "源码目录：$SRC"

# 取源码：已有就更新，没有就 clone（没有 git 就下 tarball）。
fetch() {
  dest="$1"
  tmp="$dest.tmp.$$"
  rm -rf "$tmp"
  mkdir -p "$(dirname "$dest")"

  if command -v git >/dev/null 2>&1; then
    say "git clone $REPO（$REF）"
    git clone --depth 1 --branch "$REF" "$REPO" "$tmp" >/dev/null 2>&1 \
      || die "clone 失败：$REPO。网络不通时先设代理，或用 DSH_KEY_SWITCH_SRC 指本地目录。"
    rm -rf "$dest"
    mv "$tmp" "$dest"
    return 0
  fi

  case "$REPO" in
    *github.com/*/*) ;;
    *) die '没有 git，且仓库地址不是 GitHub，装不了。先装 git 再用同一条命令。' ;;
  esac
  slug="${REPO#*github.com/}"
  slug="${slug%.git}"
  slug="${slug%/}"
  url="https://codeload.github.com/$slug/tar.gz/refs/heads/$REF"

  say "下载 $url"
  mkdir -p "$tmp"
  # 解包在 tmp 里用相对文件名做：Windows 的 D:/… 会被 tar 当成「主机:路径」。
  archive="pkg.tar.gz"
  if command -v curl >/dev/null 2>&1; then
    ( cd "$tmp" && curl -fsSL "$url" -o "$archive" ) || die "下载失败：$url"
  elif command -v wget >/dev/null 2>&1; then
    ( cd "$tmp" && wget -q "$url" -O "$archive" ) || die "下载失败：$url"
  else
    die '既没有 git 也没有 curl / wget，装不了。'
  fi
  ( cd "$tmp" && tar -xzf "$archive" ) || die '解包失败'
  rm -f "$tmp/$archive"

  # GitHub 的 tarball 会多套一层 <repo>-<ref>/ 目录。
  found="$tmp"
  if [ ! -f "$found/install.mjs" ]; then
    for entry in "$tmp"/*; do
      if [ -f "$entry/install.mjs" ]; then found="$entry"; break; fi
    done
  fi
  [ -f "$found/install.mjs" ] || die '下载的包里没有 install.mjs'
  rm -rf "$dest"
  mv "$found" "$dest"
  rm -rf "$tmp"
}

if [ "$LOCAL_SRC" -eq 1 ]; then
  [ -f "$SRC/install.mjs" ] || die "DSH_KEY_SWITCH_SRC 里没有 install.mjs：$SRC"
  say '使用指定的本地源码'
elif [ -f "$SRC/install.mjs" ] && [ -e "$SRC/.git" ] && command -v git >/dev/null 2>&1; then
  say '更新已有源码…'
  git -C "$SRC" pull --ff-only --quiet >/dev/null 2>&1 || say '（更新失败，用现有版本继续）'
else
  # 没装过，或上次是用 tarball 装的（没有 .git，pull 不了）：重新取一份。
  fetch "$SRC"
fi

[ -f "$SRC/install.mjs" ] || die "源码不完整：$SRC"

say ''
set +e
node "$SRC/install.mjs" "$@"
status=$?
set -e

if [ "$status" -eq 0 ]; then
  case " $* " in
    *" --print-target "*|*" --help "*|*" -h "*) ;;
    *)
      say ''
      if [ -e "$SRC/.git" ]; then
        say "下次更新：cd \"$SRC\" && git pull，再跑 node install.mjs"
      else
        say '下次更新：再跑一次这条命令（会重新下载一份源码）'
      fi
      say "卸载：node \"$SRC/uninstall.mjs\""
      ;;
  esac
fi
exit "$status"
