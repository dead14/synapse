import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

// Assume these icons are imported from an icon library
import {
  BoxCubeIcon,
  CalenderIcon,
  ChatIcon,
  ChevronDownIcon,
  DocsIcon,
  GridIcon,
  HorizontaLDots,
  ListIcon,
  MailIcon,
  PageIcon,
  PieChartIcon,
  PlugInIcon,
  TableIcon,
  TaskIcon,
  UserCircleIcon,
} from "../icons";
import { useSidebar } from "../context/SidebarContext";

type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  subItems?: { name: string; path: string; pro?: boolean; new?: boolean }[];
};

const navItems: NavItem[] = [
  { icon: <GridIcon />, name: "Dashboard", path: "/" },
  { 
    icon: <BoxCubeIcon />, 
    name: "Data Management",
    subItems: [
      { name: "Data", path: "/data" },
      { name: "ILI Alignment", path: "/alignment" },
      { name: "Log Report", path: "/log-report" },
      { name: "Reporting & Visualization", path: "/reports" },
      { name: "Audit & Traceability", path: "/audit" }
    ]
  },
  { 
    icon: <PieChartIcon />, 
    name: "Integrity Analysis",
    subItems: [
      { name: "Corrosion Analysis", path: "/corrosion" },
      { name: "FFS: New Assessment", path: "/ffs" },
      { name: "FFS: Assessment History", path: "/ffs/history" },
      { name: "Remaining Life & Risk", path: "/risk" }
    ]
  },
  { 
    icon: <TaskIcon />, 
    name: "Operations & Tracking",
    subItems: [
      { name: "Tool Performance Tracking", path: "/performance" },
      { name: "Repair & Excavation Tracking", path: "/repair" }
    ]
  },
  { 
    icon: <UserCircleIcon />, 
    name: "Administration",
    subItems: [
      { name: "User List", path: "/users" },
      { name: "Add User", path: "/users/add" },
      { name: "Organizations", path: "/organizations" },
      { name: "Roles & Permissions", path: "/roles" },
      { name: "Activity Logs", path: "/activity-logs" },
      { name: "Setting and account", path: "/settings" }
    ]
  }
];

const AppSidebar: React.FC = () => {
  const location = useLocation();

  const [openSubmenu, setOpenSubmenu] = useState<{
    index: number;
  } | null>(null);

  const isActive = useCallback(
    (path: string) => location.pathname === path,
    [location.pathname]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!(event.target as Element).closest('.nav-dropdown-container')) {
        setOpenSubmenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSubmenuToggle = (index: number) => {
    setOpenSubmenu((prevOpenSubmenu) => {
      if (prevOpenSubmenu && prevOpenSubmenu.index === index) {
        return null;
      }
      return { index };
    });
  };

  const renderMenuItems = (items: NavItem[]) => (
    <ul className="flex flex-row items-center gap-1 flex-wrap w-full px-2">
      {items.map((nav, index) => (
        <li key={nav.name} className="relative nav-dropdown-container shrink-0">
          {nav.subItems ? (
            <button
              onClick={() => handleSubmenuToggle(index)}
              className={`menu-item group ${
                openSubmenu?.index === index
                  ? "menu-item-active"
                  : "menu-item-inactive"
              } cursor-pointer flex flex-row items-center gap-2 px-3 py-2 rounded-lg`}
            >
              <span
                className={`menu-item-icon-size ${
                  openSubmenu?.index === index
                    ? "menu-item-icon-active"
                    : "menu-item-icon-inactive"
                }`}
              >
                {nav.icon}
              </span>
              <span className="menu-item-text whitespace-nowrap">{nav.name}</span>
              <ChevronDownIcon
                className={`ml-1 w-3.5 h-3.5 transition-transform duration-200 ${
                  openSubmenu?.index === index
                    ? "rotate-180 text-brand-500"
                    : ""
                }`}
              />
            </button>
          ) : (
            nav.path && (
              <Link
                to={nav.path}
                className={`menu-item group flex flex-row items-center gap-2 px-3 py-2 rounded-lg ${
                  isActive(nav.path) ? "menu-item-active" : "menu-item-inactive"
                }`}
              >
                <span
                  className={`menu-item-icon-size ${
                    isActive(nav.path)
                      ? "menu-item-icon-active"
                      : "menu-item-icon-inactive"
                  }`}
                >
                  {nav.icon}
                </span>
                <span className="menu-item-text whitespace-nowrap">{nav.name}</span>
              </Link>
            )
          )}
          
          {/* Dropdown Menu */}
          {nav.subItems && (
            <div
              className={`absolute top-full left-0 mt-1 min-w-[200px] bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-100 dark:border-gray-700 transition-all duration-200 z-50 ${
                openSubmenu?.index === index
                  ? "opacity-100 visible translate-y-0"
                  : "opacity-0 invisible -translate-y-2 pointer-events-none"
              }`}
            >
              <ul className="py-2 flex flex-col">
                {nav.subItems.map((subItem) => (
                  <li key={subItem.name}>
                    <Link
                      to={subItem.path}
                      onClick={() => setOpenSubmenu(null)}
                      className={`block px-4 py-2 text-sm transition-colors ${
                        isActive(subItem.path)
                          ? "bg-brand-50 text-brand-600 font-medium dark:bg-gray-700 dark:text-brand-400"
                          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                      }`}
                    >
                      {subItem.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <nav className="w-full flex items-center h-full shrink-0 z-40 relative">
      {/* Hide the old logo here since it will be in AppHeader, or keep it if needed. For now, it's a pure nav bar. */}
      {renderMenuItems(navItems)}
    </nav>
  );
};

export default AppSidebar;
