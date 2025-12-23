import os
import shutil
import time
import glob
import datetime

# 配置路径
# 注意：使用 r 前缀避免转义问题
SOURCE_DIR = r"E:\业务全景图_google\LocalStorage_Flow"
TARGET_FILE = r"E:\业务全景图_google\public\data\complete-business-flow.json"

def get_latest_file(directory):
    """获取目录下修改时间最新的 flow-*.json 文件"""
    search_pattern = os.path.join(directory, "flow-*.json")
    files = glob.glob(search_pattern)
    if not files:
        return None
    #按修改时间排序
    return max(files, key=os.path.getmtime)

def sync_monitor():
    print("="*40)
    print("   自动同步监控脚本 (Sync Monitor)")
    print("="*40)
    print(f"监控目录: {SOURCE_DIR}")
    print(f"同步目标: {TARGET_FILE}")
    print("-" * 40)

    # 确保源目录存在
    if not os.path.exists(SOURCE_DIR):
        print(f"创建目录: {SOURCE_DIR}")
        os.makedirs(SOURCE_DIR, exist_ok=True)

    # 初始化状态
    last_synced_time = 0
    
    # 如果目标文件已存在，用它的修改时间作为基准，避免重复覆盖
    if os.path.exists(TARGET_FILE):
        last_synced_time = os.path.getmtime(TARGET_FILE)

    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] 开始监控，请在网页中保存文件...")

    while True:
        try:
            latest_file = get_latest_file(SOURCE_DIR)
            
            if latest_file:
                current_mtime = os.path.getmtime(latest_file)
                
                # 如果发现比最后一次同步还要新的文件 (且时间差大于1秒避免精度误差)
                if current_mtime > last_synced_time + 1:
                    filename = os.path.basename(latest_file)
                    print(f"\n[{datetime.datetime.now().strftime('%H:%M:%S')}] 检测到新文件: {filename}")
                    
                    # 确保目标目录存在
                    os.makedirs(os.path.dirname(TARGET_FILE), exist_ok=True)
                    
                    # 执行复制
                    shutil.copy2(latest_file, TARGET_FILE)
                    print(f"   -> 已成功同步到项目默认数据 (complete-business-flow.json)")
                    
                    # 更新时间戳
                    last_synced_time = current_mtime
            
            # 每 2 秒检查一次
            time.sleep(2)
            
        except Exception as e:
            print(f"\nError: {e}")
            time.sleep(5)

if __name__ == "__main__":
    # 为了防止意外关闭，包裹在 try-except 中
    try:
        sync_monitor()
    except KeyboardInterrupt:
        print("\n监控已停止。")
