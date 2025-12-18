@echo off
chcp 65001 >nul
title 业务流程全景图 - React Flow

echo ========================================
echo    业务流程全景图 - React Flow
echo ========================================
echo.

:: 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

:: 显示 Node.js 版本
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo [信息] Node.js 版本: %NODE_VERSION%

:: 检查依赖是否已安装
if not exist "node_modules" (
    echo [信息] 正在安装依赖...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
    echo [成功] 依赖安装完成
)

echo.
echo [信息] 正在启动开发服务器...
echo [提示] 访问地址: http://localhost:3000
echo [提示] 按 Ctrl+C 停止服务器
echo ========================================
echo.

:: 启动开发服务器
call npm run dev
