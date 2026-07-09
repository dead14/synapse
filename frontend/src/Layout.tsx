
import { 
  FiGrid, FiDatabase, FiActivity, FiShield, FiTrendingUp, 
  FiPieChart, FiTarget, FiTool, FiList, FiSettings, FiUser
} from 'react-icons/fi';
import { useLocation, useNavigate } from 'react-router-dom';

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();

  const menuItems = [
    { name: 'Dashboard', icon: <FiGrid size={20} />, path: '/' },
    { name: 'Data Management', icon: <FiDatabase size={20} />, path: '/data' },
    { name: 'Corrosion Analysis', icon: <FiActivity size={20} />, path: '/corrosion' },
    { name: 'FFS Anomaly Assessment', icon: <FiShield size={20} />, path: '/ffs' },
    { name: 'Remaining Life & Risk', icon: <FiTrendingUp size={20} />, path: '/risk' },
    { name: 'Reporting & Visualization', icon: <FiPieChart size={20} />, path: '/reports' },
    { name: 'Tool Performance', icon: <FiTarget size={20} />, path: '/performance' },
    { name: 'Repair & Excavation', icon: <FiTool size={20} />, path: '/repair' },
    { name: 'Audit & Traceability', icon: <FiList size={20} />, path: '/audit' },
    { name: 'Setting and Account', icon: <FiSettings size={20} />, path: '/settings' }
  ];

  return (
    <div className="w-screen h-screen bg-[#f8f9fc] flex font-sans text-gray-700 overflow-hidden">
      
      {/* Expanded Sidebar */}
      <div className="w-64 bg-white border-r border-gray-100 flex flex-col py-8 px-4 shadow-sm z-10 shrink-0">
        <h2 className="font-bold text-lg text-gray-900 mb-8 px-4">Pipeline integrity suite</h2>
        
        <div className="flex flex-col gap-2">
          {menuItems.map((item, idx) => {
            const isActive = location.pathname === item.path;
            return (
              <div 
                key={idx}
                onClick={() => navigate(item.path)}
                className={`flex items-center gap-4 px-4 py-3 rounded-xl cursor-pointer transition-colors font-medium
                  ${isActive 
                    ? 'bg-[#dbeafe] text-blue-700' 
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
              >
                {item.icon}
                <span>{item.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto">
        {children}
      </div>

    </div>
  );
}
